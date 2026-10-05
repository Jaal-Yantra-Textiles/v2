import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { notifyPartnerOfInventoryOrder } from "../workflows/inventory_orders/lib/notify-partner-of-order"

/**
 * An inventory order was SENT to a partner → tell them on WhatsApp, item by
 * item, and ask them to confirm the quantities.
 *
 * Only `send-to-partner` emits this event. `assign-partner` (recording work
 * agreed offline) deliberately does not, so it still tells nobody.
 *
 * Kill switch: INVENTORY_ORDER_ASSIGNED_WHATSAPP=false.
 */
export default async function inventoryOrderAssignedWhatsapp({
  event,
  container,
}: SubscriberArgs<{ inventory_order_id?: string; partner_id?: string; notes?: string | null }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  if (process.env.INVENTORY_ORDER_ASSIGNED_WHATSAPP === "false") {
    return
  }
  const orderId = event.data?.inventory_order_id
  const partnerId = event.data?.partner_id
  if (!orderId || !partnerId) {
    return
  }

  try {
    const outcome = await notifyPartnerOfInventoryOrder(container as any, {
      inventory_order_id: String(orderId),
      partner_id: String(partnerId),
      notes: event.data?.notes ?? null,
    })
    if (outcome.sent) {
      logger.info(
        `[inventory-order-whatsapp] told partner ${partnerId} about ${orderId} via ${outcome.via}${outcome.truncated ? " (truncated)" : ""}`
      )
    } else {
      logger.warn(`[inventory-order-whatsapp] not sent for ${orderId}: ${outcome.reason}`)
    }
  } catch (e: any) {
    // The order WAS sent; a failed courtesy message must not make it look
    // otherwise. The admin can still message the partner from the inbox.
    logger.error(
      `[inventory-order-whatsapp] failed for ${orderId} → ${partnerId}: ${e?.message || String(e)}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "inventory_order_assigned_to_partner",
}
