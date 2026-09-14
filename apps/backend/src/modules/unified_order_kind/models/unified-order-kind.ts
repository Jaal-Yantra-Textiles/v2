import { model } from "@medusajs/framework/utils"

/**
 * #2029 item 4 — 1:1 sidecar holding WHAT KIND of work-order a unified order
 * is, promoted off `order.metadata.collated_design_order`.
 *
 * ## Why this is not a field on `unified_order_status`
 *
 * That table's row presence means "this order has reached a partner-tracked
 * state", and its writer is guarded: `setUnifiedOrderPartnerStatus` is only
 * called `if (partnerStatus)`, and `aggregatePartnerStatus` returns `undefined`
 * when every run is cancelled or declined (`run-partner-status.ts:76`). So a
 * collated order whose runs were all declined has NO status row at all.
 *
 * A kind that rode on that table would therefore be missing for exactly those
 * orders and read as "not collated" — which renders the partner a
 * single-design screen for an order holding several. That is the same shape as
 * #1574, where the mirror's write-only-truthy rule left `partner_status` at a
 * stale value and an admin-cancelled order went on rendering as live work.
 *
 * So: its own row, and the write is UNCONDITIONAL.
 *
 * ## Why a row at all, rather than counting runs
 *
 * The order↔run link answers "has runs", not "is collated". A collated order
 * whose siblings were cancelled still holds one run and must keep rendering as
 * collated; counting would silently flip it to per-run and change the screen
 * the partner sees.
 */
const UnifiedOrderKind = model.define("unified_order_kind", {
  id: model.id({ prefix: "uok" }).primaryKey(),
  /**
   * `collated` — one work-order collecting several runs (#826), rendered as the
   * multi-design screen.
   * `per_run` — the ordinary one-run mirror.
   *
   * An explicit `per_run` rather than "absent means per-run": absence is how
   * this fact went wrong in the first place, and a row that says so is the
   * difference between "this is a per-run order" and "nobody has told me".
   */
  kind: model.enum(["collated", "per_run"]),
})

export default UnifiedOrderKind
