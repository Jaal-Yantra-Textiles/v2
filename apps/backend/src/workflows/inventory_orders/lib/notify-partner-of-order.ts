import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { sendPartnerText, type PartnerTextOutcome } from "../../whatsapp/send-partner-text"
import { composeOrderMessage, type OrderMessageLine } from "./order-whatsapp-text"

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
 * The send itself (text in the 24-hour window, else the approved prose carrier
 * `jyt_partner_message_v1`) is `sendPartnerText`, shared with design bundles.
 *
 * Best-effort by design: the order was sent whether or not this message
 * lands, so nothing here throws. The outcome is returned for logging/tests.
 */

export const ORDER_ASSIGNED_CONTEXT_TYPE = "inventory_order"
export const orderAssignedContextId = (orderId: string) => `${orderId}:assigned`

export type NotifyOutcome = PartnerTextOutcome

export async function notifyPartnerOfInventoryOrder(
  container: MedusaContainer,
  input: { inventory_order_id: string; partner_id: string; notes?: string | null }
): Promise<NotifyOutcome> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const contextId = orderAssignedContextId(input.inventory_order_id)

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

  return sendPartnerText(container, {
    partner_id: input.partner_id,
    context_type: ORDER_ASSIGNED_CONTEXT_TYPE,
    context_id: contextId,
    compose: ({ greet_name, language }) =>
      composeOrderMessage({
        greet_name,
        order_ref: String(order.id).slice(-6).toUpperCase(),
        lines,
        total_price: Number(order.total_price) || 0,
        currency_code: order.currency_code,
        is_sample: !!order.is_sample,
        notes: input.notes,
        language,
      }),
  })
}
