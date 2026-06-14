import { defineLink } from "@medusajs/framework/utils"
import OrderModule from "@medusajs/medusa/order"
import UnifiedOrderStatusModule from "../modules/unified_order_status"

// #342 Chunk 9b (PR-F): the unified core `order` ↔ its `unified_order_status`
// sidecar row. 1:1 — an order has zero or one status row (presence means the
// order has reached a partner-tracked state). Promotes the load-bearing
// `order.metadata.partner_status` off the metadata blob onto a typed column
// (see the model for the why + feedback_no_critical_data_in_metadata).
//
// Exposed on the order as `unified_order_status` so the partner panels (PR-G)
// can pull the status in one query.graph call:
//   fields: ["id", "unified_order_status.partner_status"]
//
// `filterable: ["id"]` ingests the sidecar side into the Index Module so a
// future list filter on link existence stays possible; the transactional
// upsert (setUnifiedOrderPartnerStatus) resolves the row via query.graph, which
// is authoritative (the index is eventually consistent).
export default defineLink(
  OrderModule.linkable.order,
  {
    linkable: UnifiedOrderStatusModule.linkable.unifiedOrderStatus,
    filterable: ["id"],
    field: "unified_order_status",
  }
)
