/**
 * @file Pure component-scoping helper for partner design "components".
 * @module API/Partners/Designs/Components
 *
 * Roadmap #6 — promote admin Designs to partner-ui. Mirrors
 * `GET /admin/designs/:id/components` (the component designs that make up
 * this bundle), but a partner must only ever see components that are
 * THEIR OWN designs. A component that resolves to an admin (or another
 * partner's) design must not leak its details back through the
 * `component_design` relation, even when the partner legitimately owns
 * the parent bundle.
 */

export type ComponentEntry = {
  id: string
  component_design?: {
    id?: string
    owner_partner_id?: string | null
    [key: string]: unknown
  } | null
  [key: string]: unknown
}

/**
 * Restrict the list of bundle components to those whose COMPONENT design
 * is owned by the authenticated partner.
 *
 * Components whose `component_design` is missing, unresolved, or owned by
 * someone else are dropped — the partner only sees components that are
 * their own designs.
 *
 * @param components The full component list (may reference admin /
 *                   other-partner designs).
 * @param partnerId  The authenticated partner's id.
 */
export function scopeComponentsToPartner(
  components: ComponentEntry[],
  partnerId: string
): ComponentEntry[] {
  return (components || []).filter(
    (c) =>
      c != null &&
      c.component_design != null &&
      c.component_design.owner_partner_id === partnerId
  )
}
