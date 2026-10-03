import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import type { IAuthModuleService } from "@medusajs/framework/types"

import { PHONE_PIN_AUTH_PROVIDER } from "../../../modules/phone-pin-auth"
import { normalizePhoneE164 } from "../../../lib/phone/normalize-phone"

export type SyncPartnerAdminPhoneIdentityInput = {
  /** The admin's auth identity. Null/undefined = admin has no login; nothing to sync. */
  authIdentityId?: string | null
  /** The phone as saved on partner_admin. Null/empty removes phone login. */
  phone?: string | null
}

type Compensation = {
  authIdentityId: string
  created?: string
  updated?: { id: string; entity_id: string }
  deleted?: { entity_id: string }
} | null

/**
 * Keep the admin's `phone-pin` provider identity in step with
 * `partner_admin.phone` (#2320). The phone identity hangs off the admin's
 * EXISTING auth identity, so a phone login carries the same
 * `app_metadata.partner_id` and the same emailpass identity that
 * `/partners/me` reads.
 *
 * Refuses a number another login already owns — two admins on one number
 * would make the login ambiguous (Medusa throws "Multiple authIdentities").
 */
export const syncPartnerAdminPhoneIdentityStep = createStep(
  "sync-partner-admin-phone-identity",
  async (input: SyncPartnerAdminPhoneIdentityInput, { container }) => {
    const phone = normalizePhoneE164(input.phone)
    if (input.phone && String(input.phone).trim() && !phone) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `"${input.phone}" is not a phone number. Use the international format, e.g. +91 98765 43210.`
      )
    }

    const authIdentityId = input.authIdentityId
    if (!authIdentityId) {
      return new StepResponse({ phone }, null as Compensation)
    }

    const authModule = container.resolve(Modules.AUTH) as IAuthModuleService

    const existing = await authModule.listProviderIdentities({
      auth_identity_id: authIdentityId,
      provider: PHONE_PIN_AUTH_PROVIDER,
    } as any)
    const current = existing[0]

    if (!phone) {
      if (!current) {
        return new StepResponse({ phone: null as string | null }, null as Compensation)
      }
      await authModule.deleteProviderIdentities([current.id])
      return new StepResponse(
        { phone: null as string | null },
        { authIdentityId, deleted: { entity_id: current.entity_id } } as Compensation
      )
    }

    if (current?.entity_id === phone) {
      return new StepResponse({ phone }, null as Compensation)
    }

    const owners = await authModule.listProviderIdentities({
      provider: PHONE_PIN_AUTH_PROVIDER,
      entity_id: phone,
    } as any)
    if (owners.some((o: any) => o.auth_identity_id !== authIdentityId)) {
      throw new MedusaError(
        MedusaError.Types.DUPLICATE_ERROR,
        "This phone number is already used to log in by another partner admin."
      )
    }

    if (current) {
      await authModule.updateProviderIdentities({ id: current.id, entity_id: phone } as any)
      return new StepResponse({ phone }, {
        authIdentityId,
        updated: { id: current.id, entity_id: current.entity_id },
      } as Compensation)
    }

    const [created] = await authModule.createProviderIdentities([
      {
        provider: PHONE_PIN_AUTH_PROVIDER,
        entity_id: phone,
        auth_identity_id: authIdentityId,
      } as any,
    ])
    return new StepResponse({ phone }, { authIdentityId, created: created.id } as Compensation)
  },
  async (comp, { container }) => {
    if (!comp) return
    const authModule = container.resolve(Modules.AUTH) as IAuthModuleService
    if (comp.created) {
      await authModule.deleteProviderIdentities([comp.created])
    } else if (comp.updated) {
      await authModule.updateProviderIdentities({
        id: comp.updated.id,
        entity_id: comp.updated.entity_id,
      } as any)
    } else if (comp.deleted) {
      await authModule.createProviderIdentities({
        provider: PHONE_PIN_AUTH_PROVIDER,
        entity_id: comp.deleted.entity_id,
        auth_identity_id: comp.authIdentityId,
      } as any)
    }
  }
)
