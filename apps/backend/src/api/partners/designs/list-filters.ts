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
  owner_partner_id?: string | null
  partner_info?: { partner_status?: string | null } | null
  [key: string]: unknown
}

/**
 * #6 — action-oriented "work" buckets shown as tabs in the partner UI. A
 * single lens over the same partner-scoped set: three collapse the
 * `partner_status` lifecycle, `yours` keys on ownership (cross-cuts status).
 */
export type DesignBucket = "all" | "incoming" | "in_progress" | "completed" | "yours"

export type DesignBucketFacets = Record<DesignBucket, number>

export type DesignListFilters = {
  q?: string
  status?: string
  bucket?: DesignBucket
  offset?: number
  limit?: number
}

/**
 * PURE: does a design belong to the given bucket? Exported for unit testing.
 *   incoming    → partner_status ∈ {incoming, assigned}       (needs acceptance)
 *   in_progress → partner_status ∈ {in_progress, awaiting_review}
 *   completed   → partner_status ∈ {finished, completed}
 *   yours       → owner_partner_id set (designs the partner created), any status
 *   all         → everything
 */
export function matchesBucket(design: PartnerDesignView, bucket: DesignBucket): boolean {
  if (bucket === "all") return true
  if (bucket === "yours") return !!design.owner_partner_id
  const ps = String(design.partner_info?.partner_status || "")
  switch (bucket) {
    case "incoming":
      return ps === "incoming" || ps === "assigned"
    case "in_progress":
      return ps === "in_progress" || ps === "awaiting_review"
    case "completed":
      return ps === "finished" || ps === "completed"
    default:
      return true
  }
}

/**
 * PURE: count how many designs fall in each bucket. Computed over the
 * q+status-filtered set (BEFORE the active bucket narrows it) so every tab
 * badge reflects the full set, not the current tab. Exported for testing.
 */
export function computeBucketFacets<T extends PartnerDesignView>(
  designs: T[]
): DesignBucketFacets {
  const facets: DesignBucketFacets = {
    all: designs.length,
    incoming: 0,
    in_progress: 0,
    completed: 0,
    yours: 0,
  }
  for (const d of designs) {
    if (matchesBucket(d, "incoming")) facets.incoming++
    if (matchesBucket(d, "in_progress")) facets.in_progress++
    if (matchesBucket(d, "completed")) facets.completed++
    if (matchesBucket(d, "yours")) facets.yours++
  }
  return facets
}

/**
 * Filter the full partner-scoped design set by `status` (exact match on
 * `design.status`) and `q` (case-insensitive substring over id / name /
 * status), then paginate. `count` is the total matched BEFORE pagination so
 * the UI pager is correct.
 */
export function applyDesignListFilters<T extends PartnerDesignView>(
  designs: T[],
  { q, status, bucket = "all", offset = 0, limit = 20 }: DesignListFilters
): { items: T[]; count: number; facets: DesignBucketFacets } {
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

  // Bucket facets are counted over the q+status set (BEFORE the active bucket
  // narrows it) so every tab badge stays accurate regardless of the open tab.
  const facets = computeBucketFacets(filtered)

  // Then narrow to the active bucket (the tab the partner is on).
  if (bucket !== "all") {
    filtered = filtered.filter((d) => matchesBucket(d, bucket))
  }

  const count = filtered.length
  const safeOffset = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20
  const items = filtered.slice(safeOffset, safeOffset + safeLimit)

  return { items, count, facets }
}
