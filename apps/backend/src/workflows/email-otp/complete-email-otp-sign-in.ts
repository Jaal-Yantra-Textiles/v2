import type { Link } from "@medusajs/framework/modules-sdk"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  when,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  createCustomerAccountWorkflow,
  setAuthAppMetadataStep,
} from "@medusajs/medusa/core-flows"

import designCustomerLink from "../../links/design-customer-link"
import { EMAIL_OTP_AUTH_PROVIDER } from "../../modules/email-otp-auth"
import { DESIGN_MODULE } from "../../modules/designs"

/**
 * Finish a buyer's email-code sign-in (#2543, phase 2).
 *
 * Runs after `POST /auth/customer/email-otp { email, code }` succeeded, with
 * the token it returned. It:
 *
 *   1. reads the VERIFIED address off the auth identity's `email-otp` provider
 *      identity (`verified_at` set by the provider on a correct code) — never
 *      from the request body, and never from another provider's identity (an
 *      emailpass registration does not prove the address);
 *   2. makes sure a customer account (`has_account: true`) is behind the auth
 *      identity — the one it already has, the existing account for that email,
 *      or a new one through Medusa's own `createCustomerAccountWorkflow`;
 *   3. ADOPTS the buyer's design-studio designs that were linked to GUEST
 *      customers with the same email (the pre-sign-in chat created those from
 *      a typed, unverified email): each is re-linked to the verified customer
 *      and the guest link removed. The guest customer row is left alone.
 *
 * Idempotent: a second run finds the account attached and nothing left to
 * adopt.
 *
 * 🔑 Adoption is scoped to designs tagged `chat-editor` — the ones this studio
 * made for a guest. A guest customer with the same email can also carry
 * designs an admin linked for an order (design-order deposits and approval
 * emails find their customer through this link), and moving those would
 * silently change who an order belongs to.
 */

export const STUDIO_DESIGN_TAG = "chat-editor"

export type CompleteEmailOtpSignInInput = { auth_identity_id: string }

export type CompleteEmailOtpSignInResult = {
  customer_id: string
  email: string
  created_customer: boolean
  adopted_design_ids: string[]
}

/** ILIKE-safe exact match for an email (escapes `%`, `_` and `\`). */
const ilikeExact = (value: string) => ({
  $ilike: value.replace(/[\\%_]/g, (c) => `\\${c}`),
})

export const resolveVerifiedOtpIdentityStep = createStep(
  "resolve-verified-otp-identity",
  async (input: CompleteEmailOtpSignInInput, { container }) => {
    const auth: any = container.resolve(Modules.AUTH)
    const identity = await auth
      .retrieveAuthIdentity(input.auth_identity_id, { relations: ["provider_identities"] })
      .catch(() => null)

    const otp = (identity?.provider_identities ?? []).find(
      (p: any) => p.provider === EMAIL_OTP_AUTH_PROVIDER && p.provider_metadata?.verified_at
    )
    if (!identity || !otp?.entity_id) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Sign in with an email code first."
      )
    }

    return new StepResponse({
      auth_identity_id: identity.id as string,
      email: String(otp.entity_id).toLowerCase(),
      customer_id: (identity.app_metadata?.customer_id as string | undefined) ?? null,
    })
  }
)

/** The existing ACCOUNT customer for this email, if the identity has none yet. */
export const findAccountCustomerStep = createStep(
  "find-account-customer-for-otp-email",
  async (input: { email: string; customer_id: string | null }, { container }) => {
    if (input.customer_id) {
      return new StepResponse({ customer_id: input.customer_id as string | null })
    }
    const customers: any = container.resolve(Modules.CUSTOMER)
    const [account] = await customers.listCustomers(
      { email: ilikeExact(input.email), has_account: true },
      { take: 1, order: { created_at: "ASC" } }
    )
    return new StepResponse({ customer_id: (account?.id as string | undefined) ?? null })
  }
)

type AdoptCompensation = Array<{ design_id: string; from: string[]; to: string }>

export const adoptGuestStudioDesignsStep = createStep(
  "adopt-guest-studio-designs",
  async (input: { customer_id: string; email: string }, { container }) => {
    const customers: any = container.resolve(Modules.CUSTOMER)
    const guests: any[] = await customers.listCustomers(
      { email: ilikeExact(input.email), has_account: false },
      { take: 200 }
    )
    const guestIds = guests.map((g) => g.id).filter((id) => id && id !== input.customer_id)
    if (!guestIds.length) {
      return new StepResponse({ adopted_design_ids: [] as string[] }, [] as AdoptCompensation)
    }

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: guestLinks = [] } = await query.graph({
      entity: designCustomerLink.entryPoint,
      fields: ["design_id", "customer_id"],
      filters: { customer_id: guestIds },
    })
    // ⚠️ An empty relation can come back as one all-null row.
    const byDesign = new Map<string, string[]>()
    for (const l of guestLinks as any[]) {
      if (!l?.design_id || !l?.customer_id) continue
      byDesign.set(l.design_id, [...(byDesign.get(l.design_id) ?? []), l.customer_id])
    }
    if (!byDesign.size) {
      return new StepResponse({ adopted_design_ids: [] as string[] }, [] as AdoptCompensation)
    }

    const designService: any = container.resolve(DESIGN_MODULE)
    const designs: any[] = await designService.listDesigns(
      { id: [...byDesign.keys()] },
      { select: ["id", "tags"], take: byDesign.size }
    )
    const studioIds = designs
      .filter((d) => Array.isArray(d?.tags) && d.tags.includes(STUDIO_DESIGN_TAG))
      .map((d) => d.id as string)
    if (!studioIds.length) {
      return new StepResponse({ adopted_design_ids: [] as string[] }, [] as AdoptCompensation)
    }

    const { data: ownLinks = [] } = await query.graph({
      entity: designCustomerLink.entryPoint,
      fields: ["design_id"],
      filters: { customer_id: input.customer_id, design_id: studioIds },
    })
    const alreadyMine = new Set((ownLinks as any[]).map((l) => l?.design_id).filter(Boolean))

    const link = container.resolve(ContainerRegistrationKeys.LINK) as Link
    const done: AdoptCompensation = []
    for (const designId of studioIds) {
      const from = byDesign.get(designId) ?? []
      if (!alreadyMine.has(designId)) {
        await link.create({
          [DESIGN_MODULE]: { design_id: designId },
          [Modules.CUSTOMER]: { customer_id: input.customer_id },
        })
      }
      for (const guestId of from) {
        await link.dismiss({
          [DESIGN_MODULE]: { design_id: designId },
          [Modules.CUSTOMER]: { customer_id: guestId },
        })
      }
      done.push({ design_id: designId, from, to: alreadyMine.has(designId) ? "" : input.customer_id })
    }

    return new StepResponse({ adopted_design_ids: studioIds }, done)
  },
  async (done, { container }) => {
    if (!done?.length) return
    const link = container.resolve(ContainerRegistrationKeys.LINK) as Link
    for (const d of done) {
      for (const guestId of d.from) {
        await link.create({
          [DESIGN_MODULE]: { design_id: d.design_id },
          [Modules.CUSTOMER]: { customer_id: guestId },
        })
      }
      if (d.to) {
        await link.dismiss({
          [DESIGN_MODULE]: { design_id: d.design_id },
          [Modules.CUSTOMER]: { customer_id: d.to },
        })
      }
    }
  }
)

export const completeEmailOtpSignInWorkflow = createWorkflow(
  "complete-email-otp-sign-in",
  (input: CompleteEmailOtpSignInInput) => {
    const identity = resolveVerifiedOtpIdentityStep(input)

    const account = findAccountCustomerStep(
      transform({ identity }, ({ identity }) => ({
        email: identity.email,
        customer_id: identity.customer_id,
      }))
    )

    // An account already exists for the verified email: sign this identity in
    // to it (passwordless login to an existing account).
    when({ identity, account }, ({ identity, account }) =>
      !identity.customer_id && !!account.customer_id
    ).then(() => {
      setAuthAppMetadataStep(
        transform({ identity, account }, ({ identity, account }) => ({
          authIdentityId: identity.auth_identity_id,
          actorType: "customer",
          value: account.customer_id as string,
        }))
      ).config({ name: "attach-otp-identity-to-customer" })
    })

    // First time for this email: Medusa's own account flow (customer row with
    // has_account, app_metadata.customer_id, customer.created).
    const created = when({ account }, ({ account }) => !account.customer_id).then(() =>
      createCustomerAccountWorkflow.runAsStep({
        input: transform({ identity }, ({ identity }) => ({
          authIdentityId: identity.auth_identity_id,
          customerData: { email: identity.email },
        })),
      })
    )

    const customer = transform({ account, created, identity }, (d) => ({
      customer_id: (d.account.customer_id ?? (d.created as any)?.id) as string,
      email: d.identity.email,
      created_customer: !d.account.customer_id,
    }))

    const adopted = adoptGuestStudioDesignsStep(
      transform({ customer }, ({ customer }) => ({
        customer_id: customer.customer_id,
        email: customer.email,
      }))
    )

    const result = transform({ customer, adopted }, (d): CompleteEmailOtpSignInResult => ({
      ...d.customer,
      adopted_design_ids: d.adopted.adopted_design_ids,
    }))

    return new WorkflowResponse(result)
  }
)
