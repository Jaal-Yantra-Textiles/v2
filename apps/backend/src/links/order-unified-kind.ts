import { defineLink } from "@medusajs/framework/utils"
import OrderModule from "@medusajs/medusa/order"
import UnifiedOrderKindModule from "../modules/unified_order_kind"

// #2029 item 4 — the unified core `order` ↔ its `unified_order_kind` sidecar.
// 1:1: an order has zero or one kind row. Promotes the load-bearing
// `order.metadata.collated_design_order` flag off the metadata blob onto a
// typed column (see the model for why it is not a field on
// `unified_order_status`).
//
// Exposed on the order as `unified_order_kind` so the partner panels can pull
// it in the same query.graph call they already make:
//   fields: ["id", "unified_order_kind.kind"]
//
// `filterable: ["id"]` mirrors the status sidecar so a future list filter on
// link existence stays possible.
export default defineLink(
  OrderModule.linkable.order,
  {
    linkable: UnifiedOrderKindModule.linkable.unifiedOrderKind,
    filterable: ["id"],
    field: "unified_order_kind",
  }
)
