import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import InventoryOrdersStockLocationsLink from "../../../links/inventory-orders-stock-locations"

/**
 * Where an inventory order's goods GO (#2286).
 *
 * 🔴 The order ↔ stock_location link holds BOTH ends of the route, told apart
 * by the `to_location` / `from_location` columns on the link row. Reading the
 * order's `stock_locations[0]` therefore picks whichever end the database
 * returns first — for GOF → Ksaman that can be GOF's own warehouse, and a
 * receipt posted there is goods banked in the city they left. The detail
 * workflow already reads the flag (`list-single-inventory-order.ts`); receipt
 * and the partner's incoming list must read it the same way.
 */

export type DestinationLinkRow = {
  inventory_orders_id?: string | null
  stock_location_id?: string | null
  to_location?: boolean | null
  from_location?: boolean | null
}

/**
 * PURE: the destination per order from its link rows.
 *
 * The row flagged `to_location` wins. An order whose ONLY location row carries
 * no flag at all is a legacy one-ended order, and that row is its destination.
 * A `from_location` row is never a destination, and two unflagged rows are
 * ambiguous — both answer null rather than guess.
 */
export function pickInventoryOrderDestinations(
  rows: DestinationLinkRow[]
): Map<string, string | null> {
  const byOrder = new Map<string, DestinationLinkRow[]>()
  for (const r of rows ?? []) {
    const id = r?.inventory_orders_id
    if (!id || !r?.stock_location_id) continue
    const list = byOrder.get(id) ?? []
    list.push(r)
    byOrder.set(id, list)
  }
  const out = new Map<string, string | null>()
  for (const [id, list] of byOrder) {
    const to = list.filter((r) => r.to_location)
    if (to.length) {
      out.set(id, String(to[to.length - 1].stock_location_id))
      continue
    }
    const unflagged = list.filter((r) => !r.to_location && !r.from_location)
    out.set(id, unflagged.length === 1 ? String(unflagged[0].stock_location_id) : null)
  }
  return out
}

async function readLinkRows(container: any, filters: Record<string, any>) {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: (InventoryOrdersStockLocationsLink as any).entryPoint,
    fields: ["inventory_orders_id", "stock_location_id", "to_location", "from_location"],
    filters,
  })
  return (data ?? []) as DestinationLinkRow[]
}

/** The destination stock location of one inventory order, or null. */
export async function resolveInventoryOrderDestination(
  container: any,
  orderId: string
): Promise<string | null> {
  if (!orderId) return null
  const rows = await readLinkRows(container, { inventory_orders_id: orderId })
  return pickInventoryOrderDestinations(rows).get(orderId) ?? null
}

/** Every inventory order whose goods are delivered TO this stock location. */
export async function listInventoryOrderIdsDeliveredTo(
  container: any,
  locationId: string
): Promise<string[]> {
  if (!locationId) return []
  const atLocation = await readLinkRows(container, { stock_location_id: locationId })
  const candidateIds = Array.from(
    new Set(atLocation.map((r) => r.inventory_orders_id).filter(Boolean) as string[])
  )
  if (!candidateIds.length) return []
  // Re-read each candidate's full route: a row at this location can be the
  // SOURCE, and only the whole set says which end it is.
  const all = await readLinkRows(container, { inventory_orders_id: candidateIds })
  const dest = pickInventoryOrderDestinations(all)
  return candidateIds.filter((id) => dest.get(id) === locationId)
}
