import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { verifyPartnerDeeplink } from "../../../modules/social-provider/whatsapp-deeplink"

/**
 * GET /partners/wa-auth?wa_token=<jwt>
 *
 * Validates a WhatsApp deep-link token and returns a partner session token.
 * Partners click links in WhatsApp messages and land here — if valid,
 * they get redirected to the portal with an active session.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const token = req.query.wa_token as string

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

  // Verify the partner still exists
  const query = req.scope.resolve("query") as any
  const { data: partners } = await query.graph({
    entity: "partners",
    fields: ["id", "name", "status"],
    filters: { id: payload.partnerId },
  })

  const partner = partners?.[0]
  if (!partner || partner.status === "inactive") {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Partner not found or inactive"
    )
  }

  // Return the partner info and redirect path
  // The frontend can use this to set up the session
  let redirectPath = "/"
  if (payload.type === "production_run" && payload.runId) {
    redirectPath = `/production-runs/${payload.runId}`
  } else if (payload.type === "design" && payload.runId) {
    redirectPath = `/designs/${payload.runId}`
  }

  return res.json({
    partner_id: payload.partnerId,
    partner_name: partner.name,
    redirect: redirectPath,
    type: payload.type,
    run_id: payload.runId,
  })
}
