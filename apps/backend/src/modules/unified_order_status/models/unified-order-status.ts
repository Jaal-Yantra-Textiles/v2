import { model } from "@medusajs/framework/utils"

/**
 * #342 Chunk 9b (PR-F) — 1:1 sidecar row holding a unified order's
 * partner-facing work-progress status, promoted OFF `order.metadata.partner_status`.
 *
 * Why a separate table (not the order's metadata)
 *   `partner_status` is load-bearing, mutated state that the partner panels read.
 *   Medusa's `updateOrders` REPLACES the whole metadata blob, so two concurrent
 *   mirrors racing a read-then-merge can lose an update (the very hazard PR-D's
 *   `withUnifiedOrderMetadataLock` guards). A typed 1:1 column is a single-column
 *   write — no read-modify-write, so no lock is needed once reads move off
 *   metadata (PR-G/PR-H). See feedback_no_critical_data_in_metadata.
 *
 * Row presence = "this order has reached a partner-tracked state". The order↔
 * unified_order_status link (src/links/order-unified-status.ts) is the 1:1
 * pointer; `partner_status` is the shared §5 vocabulary the T3 panels key on.
 */
const UnifiedOrderStatus = model.define("unified_order_status", {
  id: model.id({ prefix: "uos" }).primaryKey(),
  partner_status: model.enum([
    "assigned",
    "accepted",
    "in_progress",
    "finished",
    "partial",
    "completed",
    "declined",
  ]),
})

export default UnifiedOrderStatus
