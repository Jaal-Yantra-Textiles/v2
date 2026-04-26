import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { PARTNER_MODULE } from "../../../../../modules/partner"
import { SOCIAL_PROVIDER_MODULE } from "../../../../../modules/social-provider"
import type SocialProviderService from "../../../../../modules/social-provider/service"
import { MESSAGING_MODULE } from "../../../../../modules/messaging"
import { TEMPLATE_NAMES } from "../../../../../scripts/whatsapp-templates/partner-run-templates"

// Welcome template: dedicated to the admin-triggered onboarding flow.
// Canonical name lives in the templates spec so bumping the version
// (welcome_v1 → welcome_v2) is a one-file change.
const DEFAULT_TEMPLATE = TEMPLATE_NAMES.PARTNER_WELCOME
const DEFAULT_LANG = process.env.WHATSAPP_TEMPLATE_LANG || "hi"
const BUSINESS_NAME = process.env.WHATSAPP_BUSINESS_NAME || "JYT Textiles"

/**
 * POST /admin/partners/:id/whatsapp-verify
 *
 * "Connect on WhatsApp" — sets the partner's WhatsApp number and sends
 * a welcome template to initiate the conversation. The partner goes through
 * consent → language selection → onboarded when they reply.
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

  // Verify partner exists
  const partnerService = req.scope.resolve(PARTNER_MODULE) as any
  const partner = await partnerService.retrievePartner(partnerId).catch(() => null)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Partner not found")
  }

  // Update partner with WhatsApp number (verified = true since admin is setting it)
  await partnerService.updatePartners({
    id: partnerId,
    whatsapp_number: normalized,
    whatsapp_verified: true,
  })

  // Send welcome template to initiate the conversation
  const socialProvider = req.scope.resolve(SOCIAL_PROVIDER_MODULE) as SocialProviderService
  const whatsapp = socialProvider.getWhatsApp(req.scope)

  let waMessageId: string | null = null
  let templateSent = false

  try {
    // jyt_partner_welcome_v1 body has two placeholders:
    //   {{1}} partner name, {{2}} business name
    const waResponse = await whatsapp.sendTemplateMessage(
      normalized,
      DEFAULT_TEMPLATE,
      DEFAULT_LANG,
      [{
        type: "body",
        parameters: [
          { type: "text", text: partner.name || "Partner" },
          { type: "text", text: BUSINESS_NAME },
        ],
      }]
    )
    waMessageId = waResponse?.messages?.[0]?.id || null
    templateSent = true
  } catch (e: any) {
    console.warn(`[admin-whatsapp-connect] Failed to send template to ${normalized}:`, e.message)
  }

  // Create or find conversation for this partner + phone
  const messagingService = req.scope.resolve(MESSAGING_MODULE) as any
  const phoneDigits = normalized.replace(/[^0-9]/g, "")

  const [allConversations] = await messagingService.listAndCountMessagingConversations(
    { partner_id: partnerId },
    { take: 50 }
  )

  const existing = (allConversations || []).find((conv: any) => {
    const convDigits = (conv.phone_number || "").replace(/[^0-9]/g, "")
    return convDigits === phoneDigits || convDigits.endsWith(phoneDigits) || phoneDigits.endsWith(convDigits)
  })

  let conversationId: string
  if (existing) {
    conversationId = existing.id
  } else {
    const conv = await messagingService.createMessagingConversations({
      partner_id: partnerId,
      phone_number: normalized,
      title: partner.name,
      status: "active",
      metadata: {
        consent_source: "admin_initiated",
      },
    })
    conversationId = conv.id
  }

  // Persist the outbound template message
  if (templateSent) {
    await messagingService.createMessagingMessages({
      conversation_id: conversationId,
      direction: "outbound",
      sender_name: "System",
      content: `WhatsApp connection initiated for ${partner.name}`,
      message_type: "template",
      wa_message_id: waMessageId,
      status: waMessageId ? "sent" : "failed",
    })

    await messagingService.updateMessagingConversations({
      id: conversationId,
      last_message_at: new Date(),
    })
  }

  return res.json({
    partner_id: partnerId,
    whatsapp_number: normalized,
    whatsapp_verified: true,
    template_sent: templateSent,
    conversation_id: conversationId,
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
