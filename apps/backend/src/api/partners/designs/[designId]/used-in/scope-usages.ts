/**
 * @file Pure usage-scoping helper for partner design "used-in".
 * @module API/Partners/Designs/UsedIn
 *
 * Roadmap #6 — promote admin Designs to partner-ui. Mirrors
 * `GET /admin/designs/:id/used-in` (the bundle designs that include this
 * design as a component), but a partner must only ever see the bundles
 * THEY own. A bundle owned by admin (or another partner) that happens to
 * include this partner's component design must not leak back through the
 * `parent_design` relation.
 */

export type UsageEntry = {
  id: string
  parent_design?: {
    id?: string
    owner_partner_id?: string | null
    [key: string]: unknown
  } | null
  [key: string]: unknown
}

/**
 * Restrict the list of component-usages to those whose PARENT (bundle)
 * design is owned by the authenticated partner.
 *
 * Usages whose `parent_design` is missing, unresolved, or owned by
 * someone else are dropped — the partner only sees their own bundles.
 *
 * @param usages   The full usage list (may reference admin / other-partner
 *                 bundles).
 * @param partnerId The authenticated partner's id.
 */
export function scopeUsagesToPartner(
  usages: UsageEntry[],
  partnerId: string
): UsageEntry[] {
  return (usages || []).filter(
    (u) =>
      u != null &&
      u.parent_design != null &&
      u.parent_design.owner_partner_id === partnerId
  )
}
