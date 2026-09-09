import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { ConfigModule } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import crypto from "crypto"
import jwt from "jsonwebtoken"
import { DESIGNER_INVITE_MODULE } from "../../../../../modules/designer-invite"
import {
  hashInviteToken,
  isInviteUsable,
} from "../../../../../modules/designer-invite/lib/token"
import { createPartnerAdminWithRegistrationWorkflow } from "../../../../../workflows/partner/create-partner-admin"
import { seedDesignMoodboardIfEmpty } from "../../../../../workflows/designs/moodboard/seed-design-moodboard"
import { DESIGN_MODULE } from "../../../../../modules/designs"
import { PARTNER_MODULE } from "../../../../../modules/partner"
import designPartnerLink from "../../../../../links/design-partners-link"
import { Modules } from "@medusajs/framework/utils"
import type { IAuthModuleService } from "@medusajs/types"
import { AcceptDesignerInviteReq } from "./validators"

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "designer"
  )
}

/**
 * Accept a scoped designer invite (#1113 S1) — the "invite a stranger" path.
 *
 * Two paths, decided by whether the email is already a partner admin.
 *
 * **New designer** — mints a `designer` partner (auth identity + partner shell
 * + admin, email pre-verified), grants the design, burns the invite, returns a
 * session bearer + redirect. No separate login.
 *
 * **Existing partner** — does NOT re-register. `create-partner-admin.ts:134`
 * throws DUPLICATE_ERROR on a taken email, so inviting someone who is already
 * a partner used to fail outright even though the intent — "give this partner
 * that design" — was perfectly expressible. It now identifies the partner and
 * assigns the design to them as they are: no new partner, no new admin, name
 * and handle untouched.
 *
 * 🔴 The existing-partner path REQUIRES the account's real password. Without
 * that check, holding an invite token addressed to an existing partner would
 * mint a session for their account — and an admin can mint an invite for any
 * email, so it would be a login-as-partner primitive rather than an invite.
 * A wrong password is rejected BEFORE anything is linked or burned, so a
 * failed attempt costs the invite nothing.
 *
 * @route POST /partners/designer-invites/:token/accept
 */
export const POST = async (
  req: MedusaRequest<AcceptDesignerInviteReq> & { params: { token: string } },
  res: MedusaResponse
) => {
  const { name, email, password } = req.validatedBody

  const service: any = req.scope.resolve(DESIGNER_INVITE_MODULE)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
  const invite = await service.findByTokenHash(hashInviteToken(req.params.token))

  if (!invite) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Invite not found")
  }
  if (!isInviteUsable(invite, new Date())) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "This invite is no longer valid (expired, revoked, or already used)."
    )
  }
  // Recipient lock — a targeted invite can only be accepted by its email.
  if (invite.email && invite.email.toLowerCase() !== email.toLowerCase()) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "This invite was issued to a different email address."
    )
  }

  // 1. Who is accepting — an existing partner, or a stranger?
  const partnerService: any = req.scope.resolve(PARTNER_MODULE)
  const [existingAdmin] = await partnerService.listPartnerAdmins(
    { email },
    { relations: ["partner"] }
  )

  let partnerId: string
  let authIdentityId: string
  let existingPartner = false

  if (existingAdmin) {
    /**
     * Already a partner. Do not re-register — `create-partner-admin.ts:134`
     * would throw DUPLICATE_ERROR on the unique email, which is what made
     * inviting an existing partner impossible.
     *
     * Prove they are who they say first. `authenticate` is the same check the
     * normal partner login performs, so an invite grants exactly the access a
     * password already would — and nothing more.
     */
    const authModule = req.scope.resolve(Modules.AUTH) as IAuthModuleService
    const auth = await authModule
      .authenticate("emailpass", {
        body: { email, password },
      } as any)
      .catch(() => null as any)

    if (!auth?.success || !auth?.authIdentity?.id) {
      throw new MedusaError(
        MedusaError.Types.UNAUTHORIZED,
        "An account already exists for this email. Enter that account's password to accept this invite."
      )
    }

    const resolvedPartnerId =
      existingAdmin.partner?.id ?? existingAdmin.partner_id ?? null
    if (!resolvedPartnerId) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Partner admin ${existingAdmin.id} is not attached to a partner.`
      )
    }

    partnerId = String(resolvedPartnerId)
    authIdentityId = String(auth.authIdentity.id)
    existingPartner = true
  } else {
    // Mint the designer partner (registers emailpass auth + verifies email).
    const handle = `${slugify(name)}-${crypto.randomBytes(3).toString("hex")}`
    const nameParts = name.trim().split(/\s+/)
    const firstName = nameParts[0]
    const lastName = nameParts.slice(1).join(" ") || nameParts[0]
    const { result } = await createPartnerAdminWithRegistrationWorkflow(
      req.scope
    ).run({
      input: {
        partner: {
          name,
          handle,
          workspace_type: "designer",
          status: "active",
          is_verified: true,
        },
        admin: {
          email,
          first_name: firstName,
          last_name: lastName,
          role: "owner",
        },
        tempPassword: password,
      },
    })

    partnerId = result.partnerWithAdmin.createdPartner.id
    authIdentityId = result.registered.authIdentityId
  }

  // 2. Grant the invited design to the new partner (the assignment link the
  //    partner design GET route already checks).
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any
  /**
   * Read before writing. A brand-new partner cannot already hold the design,
   * but an existing one very well might — they may have been assigned it by
   * an admin, or accepted an earlier invite to it. `remoteLink.create` is not
   * idempotent, so a second create is an error, not a no-op.
   */
  const { data: heldAlready = [] } = await query.graph({
    entity: designPartnerLink.entryPoint,
    fields: ["design_id", "partner_id"],
    filters: { design_id: invite.design_id, partner_id: partnerId },
  })
  const alreadyAssigned = (heldAlready || []).length > 0
  if (!alreadyAssigned) {
    await remoteLink.create({
      [DESIGN_MODULE]: { design_id: invite.design_id },
      [PARTNER_MODULE]: { partner_id: partnerId },
      data: { role: invite.role || "designer" },
    })
  }

  // 3. Burn the invite.
  await service.updateDesignerInvites({
    id: invite.id,
    status: "accepted",
    accepted_partner_id: partnerId,
    accepted_at: new Date(),
  })

  // 3b. Fallback seed — if this invite was minted before moodboard seeding (or
  //     the mint-time seed was skipped), fill an empty board from the brief now
  //     so the designer opens onto a populated, editable snapshot. Best-effort.
  try {
    await seedDesignMoodboardIfEmpty(req.scope, invite.design_id)
  } catch (e: any) {
    req.scope
      .resolve(ContainerRegistrationKeys.LOGGER)
      .warn(`[designer-invite] moodboard seed on accept skipped: ${e?.message ?? e}`)
  }

  // 4. Sign a Medusa-shaped partner session bearer (same shape as
  //    generateJwtTokenForAuthIdentity / the wa-auth route) so the partner-ui
  //    is authenticated on the redirect without a separate login.
  const configModule = req.scope.resolve<ConfigModule>(
    ContainerRegistrationKeys.CONFIG_MODULE
  )
  const httpConfig = configModule.projectConfig.http as any
  const secret = httpConfig.jwtSecret
  if (!secret) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "JWT secret not configured (projectConfig.http.jwtSecret)."
    )
  }
  const sessionToken = jwt.sign(
    {
      actor_id: partnerId,
      actor_type: "partner",
      auth_identity_id: authIdentityId,
      app_metadata: { partner_id: partnerId },
    },
    secret,
    { expiresIn: httpConfig.jwtExpiresIn ?? "24h" }
  )

  res.status(201).json({
    token: sessionToken,
    partner_id: partnerId,
    design_id: invite.design_id,
    redirect: `/designs/${invite.design_id}/moodboard`,
    /**
     * So the client can say "added to your existing account" rather than
     * "welcome, your account is ready" — and can tell an assignment that
     * changed nothing from one that granted new access.
     */
    existing_partner: existingPartner,
    already_assigned: alreadyAssigned,
  })
}
