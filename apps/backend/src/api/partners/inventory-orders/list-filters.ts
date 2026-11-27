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
  created_at?: string | Date | null
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

  // Newest first, so a just-sent order is at the top of the partner's list
  // instead of the end. Sorted BEFORE paginating so page 1 is the newest set.
  // Stable: rows without a created_at keep their relative order, at the end.
  filtered = sortNewestFirst(filtered)

  const count = filtered.length
  const safeOffset = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20
  const items = filtered.slice(safeOffset, safeOffset + safeLimit)

  return { items, count }
}

const toTime = (v: unknown): number | null => {
  if (v == null || v === "") return null
  const t = new Date(v as string | Date).getTime()
  return Number.isFinite(t) ? t : null
}

/** Newest `created_at` first; rows with no usable date go last, in input order. */
export function sortNewestFirst<T extends { created_at?: unknown }>(orders: T[]): T[] {
  return orders
    .map((o, i) => ({ o, i, t: toTime(o.created_at) }))
    .sort((a, b) => {
      if (a.t == null && b.t == null) return a.i - b.i
      if (a.t == null) return 1
      if (b.t == null) return -1
      return b.t - a.t || a.i - b.i
    })
    .map((x) => x.o)
}
