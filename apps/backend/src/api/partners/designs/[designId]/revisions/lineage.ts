/**
 * @file Pure lineage-scoping helper for partner design revisions.
 * @module API/Partners/Designs/Revisions
 *
 * Roadmap #6 — promote admin Designs to partner-ui. Mirrors
 * `GET /admin/designs/:id/revisions`, but a partner must only ever see
 * the slice of a revision lineage that belongs to them. An
 * admin-originated (or another partner's) ancestor/descendant must not
 * leak through the `revised_from_id` chain.
 */

export type LineageEntry = {
  id: string
  owner_partner_id?: string | null
  revised_from_id?: string | null
  revision_number?: number | null
  [key: string]: unknown
}

export type ScopedLineage = {
  /** Lineage entries the partner owns, in ancestors→current→descendants order. */
  lineage: LineageEntry[]
  /** Topmost partner-owned design id in the visible chain (null if none). */
  root_design_id: string | null
}

/**
 * Restrict a full revision lineage to designs the partner OWNS.
 *
 * The input array is expected to already be ordered
 * ancestors→current→descendants (as produced by the revised_from_id
 * walk), so the first surviving entry is the root of the partner-visible
 * chain.
 *
 * @param full   The full lineage (may include designs owned by admin or
 *               other partners).
 * @param partnerId The authenticated partner's id.
 */
export function scopeLineageToPartner(
  full: LineageEntry[],
  partnerId: string
): ScopedLineage {
  const lineage = (full || []).filter(
    (d) => d != null && d.owner_partner_id === partnerId
  )
  return {
    lineage,
    root_design_id: lineage.length ? lineage[0].id : null,
  }
}
