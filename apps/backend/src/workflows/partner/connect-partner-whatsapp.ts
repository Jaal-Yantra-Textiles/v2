import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { PARTNER_MODULE } from "../../modules/partner"
import { SOCIAL_PROVIDER_MODULE } from "../../modules/social-provider"
import type SocialProviderService from "../../modules/social-provider/service"
import { MESSAGING_MODULE } from "../../modules/messaging"
import { TEMPLATE_NAMES } from "../../scripts/whatsapp-templates/partner-run-templates"

const DEFAULT_TEMPLATE = TEMPLATE_NAMES.PARTNER_WELCOME
const DEFAULT_LANG = process.env.WHATSAPP_TEMPLATE_LANG || "hi"
const BUSINESS_NAME = process.env.WHATSAPP_BUSINESS_NAME || "JYT Textiles"

export type ConnectPartnerWhatsappInput = {
  partner_id: string
  /** Already-normalized digits-only phone with country code. */
  phone: string
}

/** Set the partner's verified WhatsApp number. Compensation restores prior. */
type SetComp = { partner_id: string; prev_number: string | null; prev_verified: boolean }
const setPartnerWhatsappStep = createStep(
  "connect-wa-set-number",
  async (input: ConnectPartnerWhatsappInput, { container }) => {
    const partnerService: any = container.resolve(PARTNER_MODULE)
    const partner = await partnerService.retrievePartner(input.partner_id)
    await partnerService.updatePartners({
      id: input.partner_id,
      whatsapp_number: input.phone,
      whatsapp_verified: true,
    })
    return new StepResponse<{ partner_name: string }, SetComp>(
      { partner_name: partner.name || "Partner" },
      {
        partner_id: input.partner_id,
        prev_number: partner.whatsapp_number ?? null,
        prev_verified: !!partner.whatsapp_verified,
      }
    )
  },
  async (comp: SetComp | undefined, { container }) => {
    if (!comp) return
    const partnerService: any = container.resolve(PARTNER_MODULE)
    await partnerService.updatePartners({
      id: comp.partner_id,
      whatsapp_number: comp.prev_number,
      whatsapp_verified: comp.prev_verified,
    })
  }
)

/** Send the welcome template to initiate the conversation (non-fatal). */
const sendWelcomeTemplateStep = createStep(
  "connect-wa-send-welcome",
  async (input: { phone: string; partner_name: string }, { container }) => {
    const socialProvider = container.resolve(SOCIAL_PROVIDER_MODULE) as SocialProviderService
    const whatsapp = socialProvider.getWhatsApp(container as any)
    let waMessageId: string | null = null
    let templateSent = false
    try {
      const waResponse = await whatsapp.sendTemplateMessage(
        input.phone,
        DEFAULT_TEMPLATE,
        DEFAULT_LANG,
        [{ type: "body", parameters: [
          { type: "text", text: input.partner_name },
          { type: "text", text: BUSINESS_NAME },
        ] }]
      )
      waMessageId = waResponse?.messages?.[0]?.id || null
      templateSent = true
    } catch (e: any) {
      console.warn(`[connect-partner-whatsapp] template send failed to ${input.phone}:`, e.message)
    }
    return new StepResponse({ wa_message_id: waMessageId, template_sent: templateSent })
  }
)

/** Find/create the partner conversation + persist the outbound template. */
const recordConversationStep = createStep(
  "connect-wa-record-conversation",
  async (
    input: { partner_id: string; phone: string; partner_name: string; template_sent: boolean; wa_message_id: string | null },
    { container }
  ) => {
    const messagingService: any = container.resolve(MESSAGING_MODULE)
    const phoneDigits = input.phone.replace(/[^0-9]/g, "")

    const [allConversations] = await messagingService.listAndCountMessagingConversations(
      { partner_id: input.partner_id },
      { take: 50 }
    )
    const existing = (allConversations || []).find((conv: any) => {
      const d = (conv.phone_number || "").replace(/[^0-9]/g, "")
      return d === phoneDigits || d.endsWith(phoneDigits) || phoneDigits.endsWith(d)
    })

    let conversationId: string
    if (existing) {
      conversationId = existing.id
    } else {
      const conv = await messagingService.createMessagingConversations({
        partner_id: input.partner_id,
        phone_number: input.phone,
        title: input.partner_name,
        status: "active",
        metadata: { consent_source: "admin_initiated" },
      })
      conversationId = conv.id
    }

    if (input.template_sent) {
      await messagingService.createMessagingMessages({
        conversation_id: conversationId,
        direction: "outbound",
        sender_name: "System",
        content: `WhatsApp connection initiated for ${input.partner_name}`,
        message_type: "template",
        wa_message_id: input.wa_message_id,
        status: input.wa_message_id ? "sent" : "failed",
      })
      await messagingService.updateMessagingConversations({
        id: conversationId,
        last_message_at: new Date(),
      })
    }
    return new StepResponse({ conversation_id: conversationId })
  }
)

export const connectPartnerWhatsappWorkflow = createWorkflow(
  "connect-partner-whatsapp",
  (input: ConnectPartnerWhatsappInput) => {
    const set = setPartnerWhatsappStep(input)
    const sent = sendWelcomeTemplateStep({ phone: input.phone, partner_name: set.partner_name })
    const conv = recordConversationStep({
      partner_id: input.partner_id,
      phone: input.phone,
      partner_name: set.partner_name,
      template_sent: sent.template_sent,
      wa_message_id: sent.wa_message_id,
    })
    return new WorkflowResponse({
      template_sent: sent.template_sent,
      conversation_id: conv.conversation_id,
    })
  }
)
