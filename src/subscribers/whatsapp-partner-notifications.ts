import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { SOCIAL_PROVIDER_MODULE } from "../modules/social-provider"
import type SocialProviderService from "../modules/social-provider/service"
import { PRODUCTION_RUNS_MODULE } from "../modules/production_runs"
import type ProductionRunService from "../modules/production_runs/service"
import { MESSAGING_MODULE } from "../modules/messaging"
import { TEMPLATE_NAMES } from "../scripts/whatsapp-templates/partner-run-templates"

/**
 * Legacy subscriber. The new canonical path is the visual flow seeded by
 * src/scripts/seed-partner-run-whatsapp-flow.ts — activate it and set
 * DISABLE_LEGACY_WHATSAPP_PARTNER_SUBSCRIBER=1 to turn this off.
 *
 * Until the flow is active, this subscriber still handles partner-facing
 * sends for sent_to_partner + cancelled events. Template names are pulled
 * from the shared spec so bumping a version (_v3 → _v4) propagates here
 * automatically — no more hardcoded dead names.
 *
 * Language is read from conversation metadata (set during partner onboarding).
 * Falls back to WHATSAPP_TEMPLATE_LANG env var, then "hi" (Hindi).
 */
const DEFAULT_LANG = process.env.WHATSAPP_TEMPLATE_LANG || "hi"

const TEMPLATES = {
  assigned: TEMPLATE_NAMES.RUN_ASSIGNED,
  cancelled: TEMPLATE_NAMES.RUN_CANCELLED,
} as const

/**
 * Sends WhatsApp template notifications to partners when production runs
 * are assigned or cancelled. Uses templates (not free-form) so messages
 * are delivered regardless of the 24-hour window state.
 */
export default async function whatsappPartnerNotificationHandler({
  event,
  container,
}: SubscriberArgs<{
  id: string
  production_run_id?: string
  partner_id?: string
  design_id?: string
  status?: string
  action?: string
  notes?: string
}>) {
  const data = event.data
  if (!data) return

  // Opt-out gate — when the visual-flow dispatcher
  // (src/scripts/seed-partner-run-whatsapp-flow.ts) is activated, set
  // DISABLE_LEGACY_WHATSAPP_PARTNER_SUBSCRIBER=1 to shut off this path
  // and prevent double-sends. The flag is deliberately off by default so
  // existing deployments keep working until operators explicitly switch.
  if (process.env.DISABLE_LEGACY_WHATSAPP_PARTNER_SUBSCRIBER === "1") {
    return
  }

  // Check if WhatsApp is configured
  if (!process.env.WHATSAPP_PHONE_NUMBER_ID || !process.env.WHATSAPP_ACCESS_TOKEN) {
    return // WhatsApp not configured, skip silently
  }

  const runId = data.production_run_id || data.id
  if (!runId) return

  const action = data.action || event.name?.split(".").pop() || "unknown"

  try {
    const socialProvider = container.resolve(SOCIAL_PROVIDER_MODULE) as SocialProviderService
    const whatsapp = socialProvider.getWhatsApp(container)

    // Resolve the production run to get partner_id
    const productionRunService: ProductionRunService = container.resolve(PRODUCTION_RUNS_MODULE)
    const run = await productionRunService.retrieveProductionRun(runId).catch(() => null) as any
    if (!run) return

    const partnerId = data.partner_id || run.partner_id
    if (!partnerId) return

    // Find partner admin phone numbers and name
    const { phones, partnerName } = await getPartnerInfo(container, partnerId)
    if (phones.length === 0) return

    // Get design name for context
    const designName = await getDesignName(container, run.design_id)

    // Send appropriate template based on action
    for (const phone of phones) {
      try {
        let waResponse: any = null
        let messageContent = ""

        // Resolve language from existing conversation metadata, fall back to default
        const lang = await getPartnerLanguage(container, partnerId, phone) || DEFAULT_LANG

        switch (action) {
          case "sent_to_partner":
            messageContent = `New Production Run Assigned — ${designName} (${run.id})`
            waResponse = await whatsapp.sendTemplateMessage(
              phone,
              TEMPLATES.assigned,
              lang,
              [{
                type: "body",
                parameters: [
                  { type: "text", text: partnerName },
                  { type: "text", text: designName },
                  { type: "text", text: String(run.quantity || 0) },
                  { type: "text", text: run.id },
                ],
              }]
            )
            break

          case "cancelled":
            messageContent = `Production Run Cancelled — ${designName} (${run.id})`
            waResponse = await whatsapp.sendTemplateMessage(
              phone,
              TEMPLATES.cancelled,
              lang,
              [{
                type: "body",
                parameters: [
                  { type: "text", text: partnerName },
                  { type: "text", text: run.id },
                  { type: "text", text: designName },
                  { type: "text", text: data.notes || "No reason provided" },
                ],
              }]
            )
            break
        }

        // Persist outbound notification as a message
        if (messageContent) {
          try {
            await persistOutboundNotification(container, partnerId, phone, messageContent, waResponse, run.id)
          } catch (e: any) {
            console.warn("[whatsapp-partner-notifications] Failed to persist message:", e.message)
          }
        }
      } catch (e: any) {
        console.error(
          `[whatsapp-partner-notifications] Failed to send to ${phone}:`,
          e.message
        )
      }
    }
  } catch (e: any) {
    console.error("[whatsapp-partner-notifications] Handler error:", e.message)
  }
}

async function getPartnerInfo(
  container: any,
  partnerId: string
): Promise<{ phones: string[]; partnerName: string }> {
  try {
    const partnerService = container.resolve("partner") as any

    const partner = await partnerService.retrievePartner(partnerId, {
      relations: ["admins"],
    })
    if (!partner) return { phones: [], partnerName: "Partner" }

    const partnerName = partner.name || "Partner"

    // Priority: dedicated whatsapp_number (if verified), then admin phones
    if (partner.whatsapp_number && partner.whatsapp_verified) {
      return { phones: [partner.whatsapp_number], partnerName }
    }

    const admins = partner.admins || []
    const phones = admins
      .filter((a: any) => a.is_active && a.phone)
      .map((a: any) => a.phone)
    return { phones, partnerName }
  } catch {
    return { phones: [], partnerName: "Partner" }
  }
}

async function getPartnerLanguage(container: any, partnerId: string, phone: string): Promise<string | null> {
  try {
    const messagingService = container.resolve(MESSAGING_MODULE) as any
    const phoneDigits = phone.replace(/[^0-9]/g, "")

    const [conversations] = await messagingService.listAndCountMessagingConversations(
      { partner_id: partnerId },
      { take: 50 }
    )

    const conv = (conversations || []).find((c: any) => {
      const convDigits = (c.phone_number || "").replace(/[^0-9]/g, "")
      return convDigits === phoneDigits || convDigits.endsWith(phoneDigits) || phoneDigits.endsWith(convDigits)
    })

    return (conv?.metadata as Record<string, any>)?.language || null
  } catch {
    return null
  }
}

async function getDesignName(container: any, designId: string | null): Promise<string> {
  if (!designId) return "Unknown Design"
  try {
    const designService = container.resolve("design") as any
    const design = await designService.retrieveDesign(designId)
    return design?.name || design?.title || designId
  } catch {
    return designId
  }
}

async function persistOutboundNotification(
  container: any,
  partnerId: string,
  phone: string,
  content: string,
  waResponse: any,
  runId: string
): Promise<void> {
  const messagingService = container.resolve(MESSAGING_MODULE) as any

  // Normalize phone for matching (WhatsApp sends digits-only, we may store with "+")
  const phoneDigits = phone.replace(/[^0-9]/g, "")

  // Find existing conversation by partner + phone (handle format differences)
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
    // Create conversation — don't set consent or onboarded,
    // let the actual consent/language flow handle it when the partner replies
    const conv = await messagingService.createMessagingConversations({
      partner_id: partnerId,
      phone_number: phone,
      status: "active",
      metadata: {
        consent_source: "system_notification",
      },
    })
    conversationId = conv.id
  }

  const waMessageId = waResponse?.messages?.[0]?.id || null

  await messagingService.createMessagingMessages({
    conversation_id: conversationId,
    direction: "outbound",
    sender_name: "System",
    content,
    message_type: "template",
    wa_message_id: waMessageId,
    status: waMessageId ? "sent" : "pending",
    context_type: "production_run",
    context_id: runId,
  })

  await messagingService.updateMessagingConversations({
    id: conversationId,
    last_message_at: new Date(),
  })
}

export const config: SubscriberConfig = {
  event: [
    "production_run.sent_to_partner",
    "production_run.cancelled",
  ],
}
