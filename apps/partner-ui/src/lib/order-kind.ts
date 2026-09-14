/**
 * Is this unified order a COLLATED work-order (one order, many designs)?
 *
 * #2029 item 4 — the fact used to live in `order.metadata.collated_design_order`
 * and is now a typed 1:1 sidecar (`unified_order_kind.kind`), served by both the
 * partner list and detail routes.
 *
 * 🔴 The blob is kept as a FALLBACK, not as a second opinion. An absent kind
 * means "nobody has told me" — every order written before the sidecar existed —
 * and resolving that to `per_run` would render the single-design screen for a
 * collated job, losing every design in it but the first. Only an explicit
 * `per_run` is allowed to mean per-run.
 */
export const isCollatedOrder = (order: any): boolean => {
  const kind = order?.unified_order_kind?.kind
  if (kind === "collated") {
    return true
  }
  if (kind === "per_run") {
    return false
  }
  return order?.metadata?.collated_design_order === true
}
