import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { FAIRE_SYNC_MODULE } from "../modules/faire-sync"
import FaireSyncService from "../modules/faire-sync/service"

/**
 * React to inventory updates Faire pushes (e.g. a retailer placed an order and
 * Faire decremented stock). We mirror the remote count back onto the linked
 * Medusa variant's inventory so the two systems stay consistent. Best-effort —
 * never throws.
 */
export default async function faireInventorySyncHandler({
  event: { data },
  container,
}: SubscriberArgs<{ resource?: any; resource_url?: string }>) {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const service: FaireSyncService = container.resolve(FAIRE_SYNC_MODULE)

  let payload: any = data?.resource
  if (!payload && data?.resource_url) {
    try {
      const account = await service.ensureFreshToken()
      payload = await service
        .getClient()
        .fetchResource((account as any).access_token, data.resource_url)
    } catch {
      return
    }
  }
  if (!payload) return

  const levels: any[] = Array.isArray(payload?.inventory)
    ? payload.inventory
    : Array.isArray(payload)
      ? payload
      : payload?.items
        ? payload.items
        : []
  if (!levels.length) return

  try {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const inventory: any = container.resolve(Modules.INVENTORY)

    for (const lvl of levels) {
      const sku = String(lvl.sku ?? "")
      const count = Number(lvl.current_count ?? lvl.inventory_count)
      if (!sku || !Number.isFinite(count)) continue

      // Find the linked Medusa product via sync record matching this SKU's
      // product token, then resolve its inventory item and set the level.
      const productToken = lvl.product_token ? String(lvl.product_token) : null
      if (!productToken) continue
      const [records] = await service.listSyncRecords({ product_token: productToken }, 1, 0)
      const productId = (records as any[])?.[0]?.product_id
      if (!productId) continue

      const { data: products } = await query.graph({
        entity: "product",
        fields: [
          "id",
          "variants.sku",
          "variants.inventory_items.inventory_item_id",
          "variants.inventory_items.inventory.location_levels.location_id",
          "variants.inventory_items.inventory.location_levels.stocked_quantity",
        ],
        filters: { id: productId },
      })

      const variant = (products?.[0]?.variants || []).find((v: any) => v.sku === sku)
      const invItem = (variant?.inventory_items || [])[0]
      const levels2 = invItem?.inventory?.location_levels || []
      const level = [...levels2].sort(
        (a: any, b: any) => Number(b.stocked_quantity) - Number(a.stocked_quantity)
      )[0]
      if (!invItem?.inventory_item_id || !level?.location_id) continue

      const delta = count - Number(level.stocked_quantity || 0)
      if (delta !== 0) {
        await inventory.adjustInventory(
          invItem.inventory_item_id,
          level.location_id,
          delta
        )
        logger?.info?.(
          `[faire-inventory] ${sku} adjusted by ${delta} → ${count}`
        )
      }
    }
  } catch (err: any) {
    logger?.warn?.(`[faire-inventory] sync failed: ${err?.message}`)
  }
}

export const config: SubscriberConfig = {
  event: "faire.inventory_updated",
}
