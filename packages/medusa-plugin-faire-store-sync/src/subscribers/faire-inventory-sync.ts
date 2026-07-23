import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { Link } from "@medusajs/modules-sdk"
import { FAIRE_SYNC_MODULE } from "../modules/faire-sync"
import FaireSyncService from "../modules/faire-sync/service"
import { syncProductToFaireWorkflow } from "../workflows/sync-product-to-faire"

/**
 * Push inventory to Faire when Medusa stock is CONSUMED, so a sale on any other
 * channel decrements Faire's `on_hand_quantity` and Faire buyers can't oversell
 * stock that's already gone (#1018). Without this the plugin only pushed
 * inventory on product create/update, leaving Faire stale after every sale.
 *
 * `inventory.inventory-level.updated` fires on every stock movement. The
 * generated event payload carries the changed level's `id` (and, on some paths,
 * `inventory_item_id`); we resolve either back to the owning inventory item →
 * its product(s), and re-sync ONLY products already linked to Faire. The vast
 * majority of inventory events touch non-Faire products and drop out at the link
 * guard, so this stays well inside Faire's rate budget.
 *
 * Re-uses `syncProductToFaireWorkflow` — the single source of truth for the
 * available-quantity computation (stocked − reserved) and the by-SKU push — so
 * the number Faire receives here is identical to a normal product sync.
 */
export default async function faireInventorySyncHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id?: string; inventory_item_id?: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as any
  const service: FaireSyncService = container.resolve(FAIRE_SYNC_MODULE)

  const account = await service.getActiveAccount()
  if (!account) return

  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any

  // 1) Resolve the affected inventory item id. Prefer an explicit
  //    inventory_item_id; otherwise treat `id` as the level id and look it up.
  let inventoryItemId = data?.inventory_item_id
  if (!inventoryItemId && data?.id) {
    try {
      const { data: levels } = await query.graph({
        entity: "inventory_level",
        fields: ["inventory_item_id"],
        filters: { id: data.id },
      })
      inventoryItemId = levels?.[0]?.inventory_item_id
    } catch {
      // Fall through — nothing to map.
    }
  }
  if (!inventoryItemId) return

  // 2) Map inventory item → product(s) via the variant↔inventory link pivot.
  let productIds: string[] = []
  try {
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id"],
      filters: {
        variants: { inventory_items: { inventory_item_id: inventoryItemId } },
      },
    })
    productIds = Array.from(
      new Set((products ?? []).map((p: any) => p?.id).filter(Boolean))
    )
  } catch (err: any) {
    logger?.warn?.(
      `[faire] could not resolve product for inventory item ${inventoryItemId}: ${err?.message || err}`
    )
    return
  }
  if (!productIds.length) return

  // 3) Re-sync only products already linked to Faire.
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link

  for (const productId of productIds) {
    let linked = false
    try {
      const rows = await remoteLink.list({
        [Modules.PRODUCT]: { product_id: productId },
        [FAIRE_SYNC_MODULE]: { faire_sync_account_id: account.id },
      })
      linked = Boolean((rows as any[])?.[0]?.faire_product_token)
    } catch {
      continue
    }
    if (!linked) continue

    try {
      logger?.info?.(
        `[faire] inventory changed for item ${inventoryItemId} → re-syncing linked product ${productId}`
      )
      await syncProductToFaireWorkflow(container).run({
        input: { product_id: productId },
      })
    } catch (err: any) {
      logger?.warn?.(
        `[faire] inventory re-sync failed for product ${productId}: ${err?.message || err}`
      )
    }
  }
}

export const config: SubscriberConfig = {
  event: "inventory.inventory-level.updated",
}
