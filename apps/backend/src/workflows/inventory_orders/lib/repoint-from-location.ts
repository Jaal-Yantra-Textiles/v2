import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import type { Link } from "@medusajs/modules-sdk"
import { ORDER_INVENTORY_MODULE } from "../../../modules/inventory_orders"
import inventoryOrdersStockLocations from "../../../links/inventory-orders-stock-locations"

/**
 * Read the order's current FROM-location link id (the `from_location: true`
 * row of the inventory-orders↔stock-locations link). Returns null when the
 * order has no from-link (or it was cascade-removed with a deleted location).
 */
export async function getInventoryOrderFromLinkId(
  container: MedusaContainer,
  orderId: string
): Promise<string | null> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: links } = await query.graph({
    entity: (inventoryOrdersStockLocations as any).entryPoint,
    fields: ["stock_location_id", "from_location", "to_location"],
    filters: { inventory_orders_id: orderId },
  })
  const fromLink = ((links || []) as any[]).find((l) => l?.from_location)
  return fromLink?.stock_location_id ?? null
}

/**
 * Repoint the order's FROM-location link to `fromStockLocationId`: dismisses
 * the existing from-link (if any) and creates one flagged `from_location`.
 * Shared by the gated PUT update-workflow step and the ungated
 * `repair-inventory-order-source` Data Plumbing job. Idempotent — a link
 * already pointing at the target is a no-op.
 */
export async function repointInventoryOrderFromLink(
  container: MedusaContainer,
  orderId: string,
  fromStockLocationId: string
): Promise<{ repointed: boolean; prevId: string | null }> {
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
  const prevId = await getInventoryOrderFromLinkId(container, orderId)
  if (prevId === fromStockLocationId) {
    return { repointed: false, prevId }
  }
  if (prevId) {
    await remoteLink.dismiss({
      [ORDER_INVENTORY_MODULE]: { inventory_orders_id: orderId },
      [Modules.STOCK_LOCATION]: { stock_location_id: prevId },
    })
  }
  await remoteLink.create({
    [ORDER_INVENTORY_MODULE]: { inventory_orders_id: orderId },
    [Modules.STOCK_LOCATION]: { stock_location_id: fromStockLocationId },
    data: {
      order_id: orderId,
      stock_location_id: fromStockLocationId,
      from_location: true,
      to_location: false,
    },
  })
  return { repointed: true, prevId }
}

/**
 * Inverse of `repointInventoryOrderFromLink` — used by the workflow step's
 * compensation: removes the new from-link and restores the previous one.
 */
export async function restoreInventoryOrderFromLink(
  container: MedusaContainer,
  orderId: string,
  newId: string,
  prevId: string | null | undefined
): Promise<void> {
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
  await remoteLink.dismiss({
    [ORDER_INVENTORY_MODULE]: { inventory_orders_id: orderId },
    [Modules.STOCK_LOCATION]: { stock_location_id: newId },
  })
  if (prevId) {
    await remoteLink.create({
      [ORDER_INVENTORY_MODULE]: { inventory_orders_id: orderId },
      [Modules.STOCK_LOCATION]: { stock_location_id: prevId },
      data: {
        order_id: orderId,
        stock_location_id: prevId,
        from_location: true,
        to_location: false,
      },
    })
  }
}
