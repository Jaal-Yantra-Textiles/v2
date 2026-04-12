import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { PARTNER_MODULE } from "../../../../../modules/partner"
import { SOCIAL_PROVIDER_MODULE } from "../../../../../modules/social-provider"
import type SocialProviderService from "../../../../../modules/social-provider/service"

/**
 * POST /admin/partners/:id/whatsapp-verify
 *
 * Admin-side WhatsApp number verification for a partner.
 * Allows admin to set and verify a partner's WhatsApp number directly,
 * bypassing the OTP flow.
 *
 * Body: { phone: "393933806825", notify?: boolean }
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: partnerId } = req.params
  const body = (req as any).validatedBody || req.body
  const { phone, notify = true } = body as { phone?: string; notify?: boolean }

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
      "Invalid phone number. Include country code, e.g. 393933806825"
    )
  }

  // Verify partner exists
  const partnerService = req.scope.resolve(PARTNER_MODULE) as any
  const partner = await partnerService.retrievePartner(partnerId).catch(() => null)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Partner not found")
  }

  // Update partner with verified WhatsApp number
  await partnerService.updatePartners({
    id: partnerId,
    whatsapp_number: normalized,
    whatsapp_verified: true,
  })

  // Optionally notify the partner via WhatsApp
  if (notify) {
    try {
      const socialProvider = req.scope.resolve(SOCIAL_PROVIDER_MODULE) as SocialProviderService
      const whatsapp = socialProvider.getWhatsApp(req.scope)

      await whatsapp.sendTextMessage(
        normalized,
        `✅ *WhatsApp number verified by admin!*\n\nYour WhatsApp number has been verified for *${partner.name}*.\n\nYou will now receive notifications on this number.\n\nSend *help* to see available commands.`
      )
    } catch (e: any) {
      // Non-fatal — verification succeeded even if notification fails
      console.warn(`[admin-whatsapp-verify] Failed to notify ${normalized}:`, e.message)
    }
  }

  return res.json({
    partner_id: partnerId,
    whatsapp_number: normalized,
    whatsapp_verified: true,
    notified: notify,
  })
}

/**
 * DELETE /admin/partners/:id/whatsapp-verify
 *
 * Remove WhatsApp verification from a partner.
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
