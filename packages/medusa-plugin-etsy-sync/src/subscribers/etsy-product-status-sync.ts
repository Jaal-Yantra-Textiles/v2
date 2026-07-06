import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { Link } from "@medusajs/modules-sdk"
import { ETSY_SYNC_MODULE } from "../modules/etsy-sync"
import EtsySyncService from "../modules/etsy-sync/service"
import { syncProductToEtsyWorkflow } from "../workflows/sync-product-to-etsy"

/**
 * Keep an already-synced Etsy listing in step with its Medusa product's status
 * (the draft → published transition the user cares about).
 *
 * Etsy has NO outbound webhooks, so there is nothing to receive from Etsy. This
 * is the inverse: an internal Medusa event. `product.updated` is high-frequency,
 * so we guard hard to avoid burning the ~5 qps / 10k-per-day Etsy quota:
 *   - only products that are ALREADY linked (i.e. synced at least once),
 *   - only when `follow_product_status` is on, and
 *   - only when the Medusa status ACTUALLY changed since the last sync
 *     (compared against `product_status` stored on the link metadata).
 *
 * The sync workflow does not mutate the Medusa product, so this cannot loop.
 */
export default async function etsyProductStatusSyncHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  if (!data?.id) return

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as any
  const service: EtsySyncService = container.resolve(ETSY_SYNC_MODULE)

  const account = await service.getActiveAccount()
  if (!account) return

  const settings = await service.getSettings()
  if ((settings as any).follow_product_status === false) return

  // Only react to products that have already been synced once.
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
  let row: any
  try {
    const rows = await remoteLink.list({
      [Modules.PRODUCT]: { product_id: data.id },
      [ETSY_SYNC_MODULE]: { etsy_sync_account_id: account.id },
    })
    row = (rows as any[])?.[0]
  } catch {
    return
  }
  if (!row?.etsy_listing_id) return

  // Skip unless the Medusa status changed since the last sync.
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "status"],
    filters: { id: data.id },
  })
  const status: string | undefined = products?.[0]?.status
  if (!status) return
  if (status === row?.metadata?.product_status) return

  try {
    logger?.info?.(
      `[etsy] product ${data.id} status → "${status}" (was "${row?.metadata?.product_status ?? "unknown"}"); re-syncing listing ${row.etsy_listing_id}`
    )
    await syncProductToEtsyWorkflow(container).run({
      input: { product_id: data.id },
    })
  } catch (err: any) {
    logger?.warn?.(
      `[etsy] auto re-sync failed for product ${data.id}: ${err?.message || err}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "product.updated",
}
