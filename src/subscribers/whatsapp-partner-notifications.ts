import { Modules } from "@medusajs/framework/utils"
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { SOCIAL_PROVIDER_MODULE } from "../modules/social-provider"
import type SocialProviderService from "../modules/social-provider/service"
import { PRODUCTION_RUNS_MODULE } from "../modules/production_runs"
import type ProductionRunService from "../modules/production_runs/service"
import { generatePartnerDeeplink } from "../modules/social-provider/whatsapp-deeplink"
import { MESSAGING_MODULE } from "../modules/messaging"

/**
 * Sends WhatsApp notifications to partners when production runs are assigned
 * or when admin-initiated events occur that need partner attention.
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

    // Find partner admin phone numbers
    const phones = await getPartnerPhones(container, partnerId)
    if (phones.length === 0) return

    // Get design name for context
    const designName = await getDesignName(container, run.design_id)

    // Send appropriate notification based on action
    for (const phone of phones) {
      try {
        let waResponse: any = null
        let messageContent = ""

        switch (action) {
          case "sent_to_partner":
            messageContent = `New Production Run Assigned — ${designName} (${run.id})`
            waResponse = await whatsapp.sendProductionRunAssignment(phone, {
              designName,
              runId: run.id,
              runType: run.run_type || "production",
              quantity: run.quantity,
              notes: data.notes,
              webUrl: buildPartnerWebUrl(run.id, partnerId),
            })
            break

          case "cancelled":
            messageContent = `Production Run Cancelled — ${designName} (${run.id})`
            waResponse = await whatsapp.sendTextMessage(
              phone,
              `❌ *Production Run Cancelled*\n\n` +
              `*Run:* ${run.id}\n` +
              `*Design:* ${designName}\n` +
              (data.notes ? `*Reason:* ${data.notes}\n` : "") +
              `\nThis run has been cancelled by the admin.`
            )
            break

          // Other events (accepted, started, finished, completed) are triggered
          // by the partner themselves via WhatsApp, so we don't echo them back.
          // The admin feed notifications handle admin-side visibility.
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

async function getPartnerPhones(container: any, partnerId: string): Promise<string[]> {
  try {
    const partnerService = container.resolve("partner") as any

    const partner = await partnerService.retrievePartner(partnerId, {
      relations: ["admins"],
    })
    if (!partner) return []

    // Priority: dedicated whatsapp_number (if verified), then admin phones
    if (partner.whatsapp_number && partner.whatsapp_verified) {
      return [partner.whatsapp_number]
    }

    const admins = partner.admins || []
    return admins
      .filter((a: any) => a.is_active && a.phone)
      .map((a: any) => a.phone)
  } catch {
    return []
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
    // Admin-initiated message: auto-grant consent if not already set
    const meta = existing.metadata as Record<string, any> | null
    if (!meta?.consent_given) {
      await messagingService.updateMessagingConversations({
        id: existing.id,
        metadata: {
          ...(meta || {}),
          consent_given: true,
          consent_given_at: new Date().toISOString(),
          consent_source: "admin_initiated",
          onboarded: true,
        },
      })
    }
  } else {
    // New conversation initiated by admin — consent is implicit
    const conv = await messagingService.createMessagingConversations({
      partner_id: partnerId,
      phone_number: phone,
      status: "active",
      metadata: {
        consent_given: true,
        consent_given_at: new Date().toISOString(),
        consent_source: "admin_initiated",
        onboarded: true,
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

function buildPartnerWebUrl(runId: string, partnerId: string): string {
  const baseUrl = process.env.PARTNER_PORTAL_URL || process.env.MEDUSA_BACKEND_URL || ""
  if (!baseUrl) return ""

  const { url } = generatePartnerDeeplink(
    { partner_id: partnerId, run_id: runId, type: "production_run" },
    baseUrl
  )
  return url
}

export const config: SubscriberConfig = {
  event: [
    "production_run.sent_to_partner",
    "production_run.cancelled",
  ],
}
