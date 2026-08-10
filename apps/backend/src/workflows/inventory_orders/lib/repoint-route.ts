import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import type { Link } from "@medusajs/modules-sdk"
import { ORDER_INVENTORY_MODULE } from "../../../modules/inventory_orders"
import inventoryOrdersStockLocations from "../../../links/inventory-orders-stock-locations"

export type InventoryOrderRoute = {
  fromId: string | null
  toId: string | null
}

/**
 * Read BOTH ends of the order↔stock-location link in one pass.
 *
 * `repoint-from-location.ts` reads only the from-link because the PUT path can
 * only ever move that end. Repairing a *reversed* order needs both, and needs
 * them from a single read so the two ends can't be observed at different times.
 */
export async function getInventoryOrderRoute(
  container: MedusaContainer,
  orderId: string
): Promise<InventoryOrderRoute> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: links } = await query.graph({
    entity: (inventoryOrdersStockLocations as any).entryPoint,
    fields: ["stock_location_id", "from_location", "to_location"],
    filters: { inventory_orders_id: orderId },
  })
  const rows = (links || []) as any[]
  return {
    fromId: rows.find((l) => l?.from_location)?.stock_location_id ?? null,
    toId: rows.find((l) => l?.to_location)?.stock_location_id ?? null,
  }
}

/**
 * Rewrite both ends of an inventory order's route to (`fromId`, `toId`).
 *
 * Why this exists alongside `repointInventoryOrderFromLink`: that helper moves
 * one end at a time, which cannot express a **swap**. Dismissal is keyed on
 * `(order, stock_location)` — not on the direction flag — so moving one end of
 * a reversed pair first either dismisses the row the other end still needs, or
 * leaves two rows for the same location carrying contradictory flags. Both ends
 * are therefore torn down before either is rebuilt.
 *
 * Idempotent: a route already pointing the right way is a no-op.
 */
export async function setInventoryOrderRoute(
  container: MedusaContainer,
  orderId: string,
  fromId: string,
  toId: string
): Promise<{ changed: boolean; previous: InventoryOrderRoute }> {
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
  const previous = await getInventoryOrderRoute(container, orderId)

  if (previous.fromId === fromId && previous.toId === toId) {
    return { changed: false, previous }
  }

  // Tear down every existing end first. Dismissing a location that is about to
  // be re-created is deliberate — see the docblock above.
  const stale = [previous.fromId, previous.toId].filter(
    (id, i, all): id is string => Boolean(id) && all.indexOf(id) === i
  )
  for (const locationId of stale) {
    await remoteLink.dismiss({
      [ORDER_INVENTORY_MODULE]: { inventory_orders_id: orderId },
      [Modules.STOCK_LOCATION]: { stock_location_id: locationId },
    })
  }

  await remoteLink.create({
    [ORDER_INVENTORY_MODULE]: { inventory_orders_id: orderId },
    [Modules.STOCK_LOCATION]: { stock_location_id: fromId },
    data: {
      order_id: orderId,
      stock_location_id: fromId,
      from_location: true,
      to_location: false,
    },
  })
  await remoteLink.create({
    [ORDER_INVENTORY_MODULE]: { inventory_orders_id: orderId },
    [Modules.STOCK_LOCATION]: { stock_location_id: toId },
    data: {
      order_id: orderId,
      stock_location_id: toId,
      from_location: false,
      to_location: true,
    },
  })

  return { changed: true, previous }
}
