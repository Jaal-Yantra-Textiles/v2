import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * When an order is placed, auto-link the customer to the store
 * that owns the order's sales channel.
 */
export default async function customerStoreLinkHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = event.data.id
  if (!orderId) return

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as any

  // Get the order's customer and sales channel
  const { data: orders } = await query.graph({
    entity: "orders",
    fields: ["customer_id", "sales_channel_id"],
    filters: { id: orderId },
  })

  const order = orders?.[0] as any
  if (!order?.customer_id || !order?.sales_channel_id) return

  // Find the store that has this sales channel as its default
  const { data: stores } = await query.graph({
    entity: "stores",
    fields: ["id"],
    filters: { default_sales_channel_id: order.sales_channel_id },
  })

  const store = stores?.[0]
  if (!store) return

  // Link customer to store (idempotent — ignore if already linked)
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any
  try {
    await remoteLink.create({
      [Modules.STORE]: { store_id: store.id },
      [Modules.CUSTOMER]: { customer_id: order.customer_id },
    })
    logger.info(
      `Linked customer ${order.customer_id} to store ${store.id} from order ${orderId}`
    )
  } catch {
    // Already linked — no-op
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
