import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import inboundEmailInventoryOrderLink from "../../../links/inbound-email-inventory-order"
import { INBOUND_EMAIL_MODULE } from "../../../modules/inbound_emails"
import { ORDER_INVENTORY_MODULE } from "../../../modules/inventory_orders"

/**
 * #2377 S3 — the inventory orders an email became. Read through the link's
 * own entry point (a field hop can come back empty without saying why).
 */
export async function linkedInventoryOrderIds(
  container: MedusaContainer,
  inboundEmailIds: string[]
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (!inboundEmailIds.length) return out
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: inboundEmailInventoryOrderLink.entryPoint,
    filters: { inbound_email_id: inboundEmailIds },
    fields: ["inbound_email_id", "inventory_orders_id"],
  })
  for (const row of data ?? []) {
    const list = out.get(row.inbound_email_id) ?? []
    list.push(row.inventory_orders_id)
    out.set(row.inbound_email_id, list)
  }
  return out
}

/**
 * Record that an email became this inventory order: the link, and the email
 * marked processed with the order as its action result. Linking the same pair
 * twice is a no-op, so a retried call is safe.
 */
export async function linkInboundEmailToInventoryOrder(
  container: MedusaContainer,
  inboundEmailId: string,
  inventoryOrderId: string
): Promise<{ inventory_order_ids: string[]; already_linked: boolean }> {
  const emails = container.resolve(INBOUND_EMAIL_MODULE) as any
  const email = await emails.retrieveInboundEmail(inboundEmailId).catch(() => null)
  if (!email) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Inbound email ${inboundEmailId} not found`)
  }

  const orders = container.resolve(ORDER_INVENTORY_MODULE) as any
  const order = await orders.retrieveInventoryOrder(inventoryOrderId).catch(() => null)
  if (!order) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Inventory order ${inventoryOrderId} not found`)
  }

  const existing = (await linkedInventoryOrderIds(container, [inboundEmailId])).get(inboundEmailId) ?? []
  const alreadyLinked = existing.includes(inventoryOrderId)
  if (!alreadyLinked) {
    const link: any = container.resolve(ContainerRegistrationKeys.LINK)
    await link.create({
      [INBOUND_EMAIL_MODULE]: { inbound_email_id: inboundEmailId },
      [ORDER_INVENTORY_MODULE]: { inventory_orders_id: inventoryOrderId },
    })
  }
  const ids = alreadyLinked ? existing : [...existing, inventoryOrderId]

  await emails.updateInboundEmails({
    id: inboundEmailId,
    status: "processed",
    action_type: "create_inventory_order",
    action_result: { ...(email.action_result ?? {}), inventory_order_id: ids[0], inventory_order_ids: ids },
    error_message: null,
  })

  return { inventory_order_ids: ids, already_linked: alreadyLinked }
}
