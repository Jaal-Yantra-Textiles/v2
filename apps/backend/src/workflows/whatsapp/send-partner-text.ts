import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { MESSAGING_MODULE } from "../../modules/messaging"
import { SOCIAL_PROVIDER_MODULE } from "../../modules/social-provider"
import type SocialProviderService from "../../modules/social-provider/service"
import { TEMPLATE_NAMES } from "../../scripts/whatsapp-templates/partner-run-templates"
import { flattenForTemplate } from "../inventory_orders/lib/order-whatsapp-text"
import { proseLanguageFor } from "./whatsapp-reminder-prose"

/**
 * Send a partner one deterministic WhatsApp message in their own thread, once
 * per (context_type, context_id).
 *
 * Inside the 24-hour window it goes as text; outside it, through the approved
 * prose carrier `jyt_partner_message_v1`, flattened with " · ". No new Meta
 * template, no approval wait.
 *
 * Lifted out of the inventory-order message (#2337) so a design bundle (#2500)
 * sends the same way.
 *
 * Best-effort: callers have already done the work the message is about, so
 * nothing here throws on a missing partner, phone or thread. Those come back as
 * `{ sent: false, reason }`.
 */

export type PartnerTextOutcome =
  | { sent: true; via: "text" | "template"; conversation_id: string; truncated: boolean }
  | { sent: false; reason: string }

export type PartnerTextLanguage = ReturnType<typeof proseLanguageFor>

const WINDOW_MS = 24 * 60 * 60 * 1000

export async function sendPartnerText(
  container: MedusaContainer,
  input: {
    partner_id: string
    context_type: string
    context_id: string
    /** Builds the message once the partner's name and language are known. */
    compose: (facts: { greet_name: string; language: PartnerTextLanguage }) => string
  }
): Promise<PartnerTextOutcome> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const messaging: any = container.resolve(MESSAGING_MODULE)

  // Once per context. A retried send must not message twice.
  const [prior] = await messaging.listAndCountMessagingMessages(
    { context_type: input.context_type, context_id: input.context_id, direction: "outbound" },
    { take: 1 }
  )
  if (prior?.length) {
    return { sent: false, reason: "already_notified" }
  }

  const { data: partners } = await query.graph({
    entity: "partners",
    fields: ["id", "name", "whatsapp_number", "admins.*"],
    filters: { id: input.partner_id },
  })
  const partner = partners?.[0]
  if (!partner) {
    return { sent: false, reason: "partner_not_found" }
  }
  const admins = ((partner.admins ?? []) as any[]).filter(Boolean)
  const primary = admins.find((a) => a.is_active !== false) ?? admins[0] ?? null

  // The partner's own thread: where they already talk to us, and where the
  // admin inbox will show this message.
  const [convs] = await messaging.listAndCountMessagingConversations(
    { partner_id: input.partner_id },
    { take: 20, order: { last_message_at: "DESC" } }
  )
  const conversation = (convs ?? []).find((c: any) => c.status !== "archived") ?? convs?.[0] ?? null
  const phone: string | null =
    conversation?.phone_number || primary?.phone || partner.whatsapp_number || null
  if (!phone) {
    return { sent: false, reason: "no_phone" }
  }
  if (!conversation) {
    // No thread means they have never been connected on WhatsApp; a cold
    // template to a number nobody linked is not ours to send from here.
    return { sent: false, reason: "no_conversation" }
  }

  const languageCode: string | null =
    (conversation.metadata as any)?.language || primary?.preferred_language || null
  const language = proseLanguageFor(languageCode || "hi")

  const text = input.compose({
    greet_name: primary?.first_name || partner.name || "Partner",
    language,
  })

  const [inbound] = await messaging.listAndCountMessagingMessages(
    { conversation_id: conversation.id, direction: "inbound" },
    { take: 1, order: { created_at: "DESC" } }
  )
  const lastInbound = inbound?.[0]?.created_at ? new Date(inbound[0].created_at).getTime() : 0
  const windowOpen = lastInbound > Date.now() - WINDOW_MS

  // Same sender the partner already talks to, when the thread has pinned one.
  const socialProvider = container.resolve(SOCIAL_PROVIDER_MODULE) as SocialProviderService
  let whatsapp: any = null
  if (conversation.default_sender_platform_id) {
    whatsapp = await socialProvider
      .getWhatsAppForPlatform(container, conversation.default_sender_platform_id)
      .catch(() => null)
  }
  if (!whatsapp) {
    whatsapp = (await socialProvider.getWhatsAppForRecipient(container, phone).catch(() => null))
      ?? socialProvider.getWhatsApp(container)
  }

  let via: "text" | "template" = "text"
  let content = text
  let truncated = false
  let waMessageId: string | null = null
  if (windowOpen) {
    const r: any = await whatsapp.sendTextMessage(phone, text)
    waMessageId = r?.messages?.[0]?.id ?? null
  } else {
    via = "template"
    const flat = flattenForTemplate(text)
    content = flat.text
    truncated = flat.truncated
    const r: any = await whatsapp.sendTemplateMessage(
      phone,
      TEMPLATE_NAMES.PARTNER_MESSAGE,
      language === "english" ? "en" : "hi",
      [{ type: "body", parameters: [{ type: "text", text: flat.text }] }]
    )
    waMessageId = r?.messages?.[0]?.id ?? null
  }

  await messaging.createMessagingMessages({
    conversation_id: conversation.id,
    direction: "outbound",
    sender_name: "JYT Bot",
    content: via === "template" ? `[template:${TEMPLATE_NAMES.PARTNER_MESSAGE}] ${content}` : content,
    message_type: via,
    wa_message_id: waMessageId,
    status: "sent",
    context_type: input.context_type,
    context_id: input.context_id,
  })

  return { sent: true, via, conversation_id: conversation.id, truncated }
}
