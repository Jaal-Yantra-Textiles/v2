import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Backfill script: Links existing customers to stores based on their order history.
 *
 * For each store, finds all orders placed through its default sales channel,
 * extracts unique customer IDs, and creates store ↔ customer links.
 *
 * Run: npx medusa exec ./src/scripts/backfill-store-customers.ts
 */
export default async function backfillStoreCustomers({ container }: ExecArgs) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as any

  logger.info("Starting store-customer backfill...")

  // Get all stores with their sales channels
  const { data: stores } = await query.graph({
    entity: "stores",
    fields: ["id", "name", "default_sales_channel_id"],
  })

  let totalLinked = 0
  let totalSkipped = 0

  for (const store of stores as any[]) {
    if (!store.default_sales_channel_id) {
      logger.info(`Store ${store.id} (${store.name}) has no sales channel — skipping`)
      continue
    }

    // Get existing linked customer IDs for this store
    const { data: storeData } = await query.graph({
      entity: "stores",
      fields: ["customers.id"],
      filters: { id: store.id },
    })
    const existingIds = new Set(
      ((storeData?.[0] as any)?.customers || []).map((c: any) => c.id)
    )

    // Find all orders for this sales channel
    const { data: orders } = await query.graph({
      entity: "orders",
      fields: ["customer_id"],
      filters: { sales_channel_id: store.default_sales_channel_id },
    })

    // Get unique customer IDs not yet linked
    const customerIds = new Set<string>()
    for (const order of orders as any[]) {
      if (order.customer_id && !existingIds.has(order.customer_id)) {
        customerIds.add(order.customer_id)
      }
    }

    if (!customerIds.size) {
      logger.info(`Store ${store.id} (${store.name}) — no new customers to link`)
      totalSkipped++
      continue
    }

    // Create links
    for (const customerId of customerIds) {
      try {
        await remoteLink.create({
          [Modules.STORE]: { store_id: store.id },
          [Modules.CUSTOMER]: { customer_id: customerId },
        })
        totalLinked++
      } catch {
        // Already linked
        totalSkipped++
      }
    }

    logger.info(
      `Store ${store.id} (${store.name}) — linked ${customerIds.size} customers`
    )
  }

  logger.info(
    `Backfill complete: ${totalLinked} new links created, ${totalSkipped} skipped`
  )
}
