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
 * Mints a brand-new `designer` partner (auth identity + partner shell + admin,
 * email pre-verified via the registration workflow), grants that partner the
 * invited design via the design↔partner link the partner design routes already
 * honor, marks the invite accepted, then returns a Medusa partner session
 * bearer + a redirect to the design's authoring surface — no separate login.
 *
 * @route POST /partners/designer-invites/:token/accept
 */
export const POST = async (
  req: MedusaRequest<AcceptDesignerInviteReq> & { params: { token: string } },
  res: MedusaResponse
) => {
  const { name, email, password } = req.validatedBody

  const service: any = req.scope.resolve(DESIGNER_INVITE_MODULE)
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

  // 1. Mint the designer partner (registers emailpass auth + verifies email).
  const handle = `${slugify(name)}-${crypto.randomBytes(3).toString("hex")}`
  const nameParts = name.trim().split(/\s+/)
  const firstName = nameParts[0]
  const lastName = nameParts.slice(1).join(" ") || nameParts[0]
  const { result } = await createPartnerAdminWithRegistrationWorkflow(req.scope).run({
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

  const partnerId: string = result.partnerWithAdmin.createdPartner.id
  const authIdentityId: string = result.registered.authIdentityId

  // 2. Grant the invited design to the new partner (the assignment link the
  //    partner design GET route already checks).
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any
  await remoteLink.create({
    [DESIGN_MODULE]: { design_id: invite.design_id },
    [PARTNER_MODULE]: { partner_id: partnerId },
    data: { role: invite.role || "designer" },
  })

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
  })
}
