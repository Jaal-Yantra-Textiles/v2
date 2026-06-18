/**
 * @file Pure list helpers for the partner inventory-orders route.
 * @description Free-text (`q`) + status filtering and pagination applied
 * in-app, AFTER the full partner-scoped set is fetched. Kept pure so the
 * search/pagination contract can be unit-tested without booting Medusa.
 *
 * Why in-app: `query.graph` cannot filter on linked-module columns
 * (inventory_orders.status) and the partner route has no free-text index, so
 * `q`/status are matched here. Critically, pagination MUST happen here too —
 * paginating inside `query.graph` slices BEFORE the filter, which returns the
 * wrong page and a per-page (not total) count. See #484.
 */

export type PartnerInventoryOrderView = {
  id: string
  status?: string | null
  stock_location?: string | null
  [key: string]: unknown
}

export type InventoryOrderListFilters = {
  q?: string
  status?: string
  offset?: number
  limit?: number
}

/**
 * Filter the full partner-scoped order set by `status` (exact) and `q`
 * (case-insensitive substring over id / status / stock location name), then
 * paginate. `count` is the total matched BEFORE pagination so the UI pager is
 * correct.
 */
export function applyInventoryOrderListFilters<T extends PartnerInventoryOrderView>(
  orders: T[],
  { q, status, offset = 0, limit = 20 }: InventoryOrderListFilters
): { items: T[]; count: number } {
  let filtered = orders

  if (status) {
    filtered = filtered.filter((o) => o.status === status)
  }

  const needle = q?.trim().toLowerCase()
  if (needle) {
    filtered = filtered.filter((o) =>
      [o.id, o.status, o.stock_location].some(
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
