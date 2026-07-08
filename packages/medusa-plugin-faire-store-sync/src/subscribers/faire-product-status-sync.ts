import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { Link } from "@medusajs/modules-sdk"
import { FAIRE_SYNC_MODULE } from "../modules/faire-sync"
import FaireSyncService from "../modules/faire-sync/service"
import { syncProductToFaireWorkflow } from "../workflows/sync-product-to-faire"

/**
 * Keep an already-synced Faire product in step with its Medusa product's status
 * (the draft → published transition the user cares about).
 *
 * This is an internal Medusa event (Faire has its own outbound webhooks for
 * product changes, handled separately). `product.updated` is high-frequency,
 * so we guard hard to avoid burning Faire's per-second / daily quota:
 *   - only products that are ALREADY linked (i.e. synced at least once),
 *   - only when `follow_product_status` is on, and
 *   - only when the Medusa status ACTUALLY changed since the last sync
 *     (compared against `product_status` stored on the link metadata).
 *
 * The sync workflow does not mutate the Medusa product, so this cannot loop.
 */
export default async function faireProductStatusSyncHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  if (!data?.id) return

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as any
  const service: FaireSyncService = container.resolve(FAIRE_SYNC_MODULE)

  const account = await service.getActiveAccount()
  if (!account) return

  const settings = await service.getSettings()
  if ((settings as any).follow_product_status === false) return

  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
  let row: any
  try {
    const rows = await remoteLink.list({
      [Modules.PRODUCT]: { product_id: data.id },
      [FAIRE_SYNC_MODULE]: { faire_sync_account_id: account.id },
    })
    row = (rows as any[])?.[0]
  } catch {
    return
  }
  if (!row?.faire_product_token) return

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
      `[faire] product ${data.id} status → "${status}" (was "${row?.metadata?.product_status ?? "unknown"}"); re-syncing product ${row.faire_product_token}`
    )
    await syncProductToFaireWorkflow(container).run({
      input: { product_id: data.id },
    })
  } catch (err: any) {
    logger?.warn?.(
      `[faire] auto re-sync failed for product ${data.id}: ${err?.message || err}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "product.updated",
}
