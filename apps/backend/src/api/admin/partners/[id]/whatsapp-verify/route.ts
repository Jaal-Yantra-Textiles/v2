import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { PARTNER_MODULE } from "../../../../../modules/partner"
import { connectPartnerWhatsappWorkflow } from "../../../../../workflows/partner/connect-partner-whatsapp"

/**
 * POST /admin/partners/:id/whatsapp-verify
 *
 * "Connect on WhatsApp" — sets the partner's WhatsApp number and sends
 * a welcome template to initiate the conversation. The partner goes through
 * consent → language selection → onboarded when they reply. Orchestration
 * (set number → send template → record conversation) lives in
 * connectPartnerWhatsappWorkflow.
 *
 * Body: { phone: "919876543210" }
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: partnerId } = req.params
  const body = (req as any).validatedBody || req.body
  const { phone } = body as { phone?: string }

  if (!phone) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Phone number is required. Provide { phone: \"<number>\" }"
    )
  }

  // Normalize: strip non-digits
  const normalized = phone.replace(/[^0-9]/g, "")
  if (normalized.length < 10) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid phone number. Include country code, e.g. 919876543210"
    )
  }

  // Verify partner exists (clean 404 from the route)
  const partnerService = req.scope.resolve(PARTNER_MODULE) as any
  const partner = await partnerService.retrievePartner(partnerId).catch(() => null)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Partner not found")
  }

  const { result } = await connectPartnerWhatsappWorkflow(req.scope).run({
    input: { partner_id: partnerId, phone: normalized },
  })

  return res.json({
    partner_id: partnerId,
    whatsapp_number: normalized,
    whatsapp_verified: true,
    template_sent: result.template_sent,
    conversation_id: result.conversation_id,
  })
}

/**
 * DELETE /admin/partners/:id/whatsapp-verify
 *
 * Disconnect WhatsApp from a partner.
 */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: partnerId } = req.params

  const partnerService = req.scope.resolve(PARTNER_MODULE) as any
  const partner = await partnerService.retrievePartner(partnerId).catch(() => null)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Partner not found")
  }

  await partnerService.updatePartners({
    id: partnerId,
    whatsapp_number: null,
    whatsapp_verified: false,
  })

  return res.json({
    partner_id: partnerId,
    whatsapp_number: null,
    whatsapp_verified: false,
  })
}
