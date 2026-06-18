/**
 * @file Pure list helpers for the partner designs route.
 * @description Free-text (`q`) + status filtering and pagination applied
 * in-app, AFTER the full partner-scoped (linked + owned) design set is
 * fetched and merged. Kept pure so the search/pagination contract can be
 * unit-tested without booting Medusa.
 *
 * Why in-app: `query.graph` cannot filter on linked-module columns
 * (design.status via the design_partners link) and the partner route has no
 * free-text index, so `q`/status are matched here. Critically, pagination
 * MUST happen here too — paginating inside `query.graph` slices BEFORE the
 * link+owned merge and the filters, which returns the wrong page and a
 * per-page (not total) count. See #484.
 */

export type PartnerDesignView = {
  id: string
  name?: string | null
  status?: string | null
  [key: string]: unknown
}

export type DesignListFilters = {
  q?: string
  status?: string
  offset?: number
  limit?: number
}

/**
 * Filter the full partner-scoped design set by `status` (exact match on
 * `design.status`) and `q` (case-insensitive substring over id / name /
 * status), then paginate. `count` is the total matched BEFORE pagination so
 * the UI pager is correct.
 */
export function applyDesignListFilters<T extends PartnerDesignView>(
  designs: T[],
  { q, status, offset = 0, limit = 20 }: DesignListFilters
): { items: T[]; count: number } {
  let filtered = designs

  if (status) {
    filtered = filtered.filter((d) => d.status === status)
  }

  const needle = q?.trim().toLowerCase()
  if (needle) {
    filtered = filtered.filter((d) =>
      [d.id, d.name, d.status].some(
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
