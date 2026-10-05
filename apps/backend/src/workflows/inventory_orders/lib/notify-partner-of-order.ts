import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { MESSAGING_MODULE } from "../../../modules/messaging"
import { SOCIAL_PROVIDER_MODULE } from "../../../modules/social-provider"
import type SocialProviderService from "../../../modules/social-provider/service"
import { TEMPLATE_NAMES } from "../../../scripts/whatsapp-templates/partner-run-templates"
import { proseLanguageFor } from "../../whatsapp/whatsapp-reminder-prose"
import {
  composeOrderMessage,
  flattenForTemplate,
  type OrderMessageLine,
} from "./order-whatsapp-text"

/**
 * Tell a partner, on WhatsApp, that an inventory order has been sent to them —
 * item by item, with quantities, asking them to confirm.
 *
 * Before this, `send-to-partner` emitted `inventory_order_assigned_to_partner`
 * and nothing turned it into a message: the order only appeared in the
 * partner's portal, and the first WhatsApp they got was "In Production" after
 * they had already started. On 2026-10-04/05 the founder had to message
 * Bhuttico, Bhagalpur and HR Handloom by hand for every order.
 *
 * Uses the approved prose carrier `jyt_partner_message_v1` outside the 24-hour
 * window, exactly like request-photos — no new template, no approval wait.
 *
 * Best-effort by design: the order was sent whether or not this message
 * lands, so nothing here throws. The outcome is returned for logging/tests.
 */

export const ORDER_ASSIGNED_CONTEXT_TYPE = "inventory_order"
export const orderAssignedContextId = (orderId: string) => `${orderId}:assigned`

export type NotifyOutcome =
  | { sent: true; via: "text" | "template"; conversation_id: string; truncated: boolean }
  | { sent: false; reason: string }

const WINDOW_MS = 24 * 60 * 60 * 1000

export async function notifyPartnerOfInventoryOrder(
  container: MedusaContainer,
  input: { inventory_order_id: string; partner_id: string; notes?: string | null }
): Promise<NotifyOutcome> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const messaging: any = container.resolve(MESSAGING_MODULE)
  const contextId = orderAssignedContextId(input.inventory_order_id)

  // Once per order. A retried send-to-partner must not message twice.
  const [prior] = await messaging.listAndCountMessagingMessages(
    { context_type: ORDER_ASSIGNED_CONTEXT_TYPE, context_id: contextId, direction: "outbound" },
    { take: 1 }
  )
  if (prior?.length) {
    return { sent: false, reason: "already_notified" }
  }

  const { data: orders } = await query.graph({
    entity: "inventory_orders",
    fields: [
      "id",
      "is_sample",
      "total_price",
      "currency_code",
      "orderlines.quantity",
      "orderlines.price",
      "orderlines.material_name",
      "orderlines.inventory_items.title",
      "orderlines.inventory_items.unit_of_measure",
    ],
    filters: { id: input.inventory_order_id },
  })
  const order = orders?.[0]
  if (!order) {
    return { sent: false, reason: "order_not_found" }
  }
  const lines: OrderMessageLine[] = ((order.orderlines ?? []) as any[])
    .filter((l) => l && Number(l.quantity) > 0)
    .map((l) => {
      const item = (l.inventory_items ?? [])[0] ?? {}
      return {
        title: String(item.title || l.material_name || "Item").trim(),
        quantity: Number(l.quantity) || 0,
        unit: item.unit_of_measure ?? null,
        price: Number(l.price) || 0,
      }
    })
  if (!lines.length) {
    // A sample created with no lines yet — nothing item-wise to confirm.
    return { sent: false, reason: "no_lines" }
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

  const text = composeOrderMessage({
    greet_name: primary?.first_name || partner.name || "Partner",
    order_ref: String(order.id).slice(-6).toUpperCase(),
    lines,
    total_price: Number(order.total_price) || 0,
    currency_code: order.currency_code,
    is_sample: !!order.is_sample,
    notes: input.notes,
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
    context_type: ORDER_ASSIGNED_CONTEXT_TYPE,
    context_id: contextId,
  })

  return { sent: true, via, conversation_id: conversation.id, truncated }
}
