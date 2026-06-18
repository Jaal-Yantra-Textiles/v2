/**
 * @file Pure list helpers for the partner reservations route.
 * @description Free-text (`q`) filtering and pagination applied in-app, AFTER
 * the full partner-location-scoped reservation set is fetched from the
 * inventory module. Kept pure so the search/pagination contract can be
 * unit-tested without booting Medusa.
 *
 * Why in-app: the partner route fetches reservation items directly via
 * `inventoryService.listAndCountReservationItems(filters)` (location-scoped),
 * which has no free-text index for `q`. Critically, pagination MUST happen
 * here too — paginating inside the service (`take`/`skip`) slices BEFORE the
 * `q` filter, which returns the wrong page and a per-page (not total) count.
 * See #484 (same page-vs-set defect fixed for inventory-orders/designs).
 */

export type PartnerReservationView = {
  id: string
  inventory_item_id?: string | null
  location_id?: string | null
  description?: string | null
  [key: string]: unknown
}

export type ReservationListFilters = {
  q?: string
  offset?: number
  limit?: number
}

/**
 * Filter the full partner-scoped reservation set by `q` (case-insensitive
 * substring over id / inventory_item_id / location_id / description), then
 * paginate. `count` is the total matched BEFORE pagination so the UI pager is
 * correct.
 */
export function applyReservationListFilters<T extends PartnerReservationView>(
  reservations: T[],
  { q, offset = 0, limit = 20 }: ReservationListFilters
): { items: T[]; count: number } {
  let filtered = reservations

  const needle = q?.trim().toLowerCase()
  if (needle) {
    filtered = filtered.filter((r) =>
      [r.id, r.inventory_item_id, r.location_id, r.description].some(
        (v) => typeof v === "string" && v.toLowerCase().includes(needle)
      )
    )
  }

  const count = filtered.length
  const safeOffset = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20
  const items = filtered.slice(safeOffset, safeOffset + safeLimit)

  return { items, count }
}
