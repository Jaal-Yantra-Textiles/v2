import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import type { ConfigModule } from "@medusajs/framework/types"
import jwt from "jsonwebtoken"
import { verifyPartnerDeeplink } from "../../../modules/social-provider/whatsapp-deeplink"
import { PARTNER_MODULE } from "../../../modules/partner"

/**
 * GET /partners/wa-auth?wa_token=<jwt>
 *
 * Validates a WhatsApp deep-link token and issues a Medusa partner
 * session token. Partners click links in WhatsApp messages and land
 * here — if the deep-link is valid, we return a Medusa-shaped bearer
 * token that the partner-ui SDK can store under
 * `partner_ui_auth_token` (its configured `jwtTokenStorageKey`).
 *
 * The deep-link JWT is signed with our own JYT secret (issuer
 * "jyt-whatsapp"). The bearer we issue is signed with Medusa's
 * configured `http.jwtSecret` and matches the shape produced by
 * Medusa's `generateJwtTokenForAuthIdentity` helper, so the framework's
 * authenticate middleware accepts it on subsequent /partners/* calls.
 *
 * Synthetic run-ids of the form "<run_id>:reminder:YYYY-MM-DD" are
 * stripped from the redirect path — those are dedup keys used by the
 * reminder dispatcher, not addressable resource ids.
 */

function stripDedupSuffix(id: string | undefined | null): string | null {
  if (!id) return null
  const colonIdx = id.indexOf(":")
  return colonIdx >= 0 ? id.slice(0, colonIdx) : id
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const token = req.query.wa_token as string | undefined

  if (!token) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Missing wa_token parameter"
    )
  }

  const payload = verifyPartnerDeeplink(token)

  if (!payload) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Invalid or expired token. Please request a new link via WhatsApp."
    )
  }

  // 1. Verify the partner still exists and is active.
  const partnerService = req.scope.resolve(PARTNER_MODULE) as any
  const partner = await partnerService
    .retrievePartner(payload.partnerId)
    .catch(() => null) as any

  if (!partner || partner.status === "inactive") {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Partner not found or inactive"
    )
  }

  // 2. Find an auth_identity for this partner. setAuthAppMetadataStep
  //    in the add-partner-admin workflow stores partner.id (the parent
  //    partner's id) under app_metadata.partner_id, so all admins of a
  //    partner share the same `actor_id` for Medusa-auth purposes. We
  //    just need one — which one doesn't matter for downstream API
  //    authorization since the actor_id is the parent partner's id.
  const authModule = req.scope.resolve(Modules.AUTH) as any
  const identities = await authModule.listAuthIdentities({
    app_metadata: { partner_id: partner.id },
  })

  const authIdentity = identities?.[0]
  if (!authIdentity) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No active auth identity found for this partner. Ask an admin to invite a user."
    )
  }

  // 3. Sign a Medusa-shaped session bearer with the same secret + payload
  //    layout that Medusa's generateJwtTokenForAuthIdentity produces.
  //    Keeping the shape exact is critical — the framework's auth middleware
  //    reads actor_id / actor_type / auth_identity_id from this payload.
  const configModule = req.scope.resolve<ConfigModule>(
    ContainerRegistrationKeys.CONFIG_MODULE,
  )
  const httpConfig = configModule.projectConfig.http
  const secret = (httpConfig as any).jwtSecret
  if (!secret) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "JWT secret not configured (projectConfig.http.jwtSecret).",
    )
  }
  const expiresIn = (httpConfig as any).jwtExpiresIn ?? "24h"

  const sessionToken = jwt.sign(
    {
      actor_id: partner.id,
      actor_type: "partner",
      auth_identity_id: authIdentity.id,
      app_metadata: { partner_id: partner.id },
    },
    secret,
    { expiresIn },
  )

  // 4. Build the post-login redirect path. The deep-link's `run_id` may
  //    carry a synthetic ":reminder:YYYY-MM-DD" suffix used as a dedup
  //    key — strip it so the partner-ui's /production-runs/:id route
  //    sees the addressable resource id.
  const cleanRunId = stripDedupSuffix(payload.runId)
  let redirectPath = "/"
  if (payload.type === "production_run" && cleanRunId) {
    redirectPath = `/production-runs/${cleanRunId}`
  } else if (payload.type === "design" && cleanRunId) {
    redirectPath = `/designs/${cleanRunId}`
  }

  return res.json({
    token: sessionToken,
    partner_id: partner.id,
    partner_name: partner.name,
    redirect: redirectPath,
    type: payload.type,
    run_id: cleanRunId,
  })
}
