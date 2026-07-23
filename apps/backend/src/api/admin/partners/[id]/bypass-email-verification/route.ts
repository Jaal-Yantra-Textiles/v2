import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { PARTNER_MODULE } from "../../../../../modules/partner"

/**
 * POST /admin/partners/:id/bypass-email-verification
 *
 * Marks the partner admin's email as verified in the auth_verification
 * system, bypassing the login gate. Uses the same auth_verification
 * upsert logic as backfillPartnerEmailVerifiedJob.
 *
 * Idempotent — if the email is already verified the call is a no-op.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: partnerId } = req.params

  const partnerService = req.scope.resolve(PARTNER_MODULE) as any
  const partner = await partnerService.retrievePartner(partnerId).catch(() => null)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Partner not found")
  }

  const authModule: any = req.scope.resolve(Modules.AUTH)

  // Determine entity type from config (same as backfill job)
  let entityType = "email"
  try {
    const config = req.scope.resolve(ContainerRegistrationKeys.CONFIG_MODULE)
    const forPartner =
      config?.projectConfig?.http?.authVerificationsPerActor?.partner
    const emailpass = (forPartner || []).find(
      (v: any) => v?.auth_provider === "emailpass"
    )
    if (emailpass?.entity_type) entityType = emailpass.entity_type
  } catch { /* default to "email" */ }

  // Find auth identities linked to this partner via app_metadata
  const identities = await authModule.listAuthIdentities(
    {},
    { relations: ["provider_identities"] }
  )

  const partnerIdentity = (identities || []).find(
    (ai: any) => ai?.app_metadata?.partner_id === partnerId
  )

  if (!partnerIdentity) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No auth identity found for this partner"
    )
  }

  const emailpass = (partnerIdentity.provider_identities || []).find(
    (p: any) => p?.provider === "emailpass"
  )

  if (!emailpass?.entity_id) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No emailpass identity found for this partner"
    )
  }

  const email = emailpass.entity_id
  const now = new Date()

  // Upsert verified auth_verification row (same logic as backfill job)
  const existing = await authModule.listAuthVerifications({
    auth_identity_id: partnerIdentity.id,
    entity_id: email,
    entity_type: entityType,
  })

  const row = existing?.[0]
  if (row) {
    if (row.verified_at) {
      return res.json({
        partner_id: partnerId,
        email,
        verified: true,
        already_verified: true,
      })
    }
    await authModule.updateAuthVerifications({
      id: row.id,
      verified_at: now,
    })
  } else {
    await authModule.createAuthVerifications([{
      auth_identity_id: partnerIdentity.id,
      entity_id: email,
      entity_type: entityType,
      code_provider: "emailpass",
      requested_at: now,
      verified_at: now,
    }])
  }

  return res.json({
    partner_id: partnerId,
    email,
    verified: true,
    already_verified: false,
  })
}
