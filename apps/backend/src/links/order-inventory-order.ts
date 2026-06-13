import { defineLink } from "@medusajs/framework/utils"
import OrderModule from "@medusajs/medusa/order"
import InventoryOrderModule from "../modules/inventory_orders"

// D5 (#342): the unified core `order` ↔ its `inventory_orders` execution row.
//
// Counterpart to order-production-run.ts. This link is the load-bearing pointer
// (replacing `inventory_orders.metadata.unified_order_id`) AND the
// discriminator: an order linked to an inventory_order is a raw-material PO
// (kind=inventory). Neither execution link → customer retail order.
//
// One unified order per inventory order, so 1:1. `filterable: ["id"]` ingests
// the inventory_orders side into the Index Module so
// `query.index({ entity: "order", filters: { inventory_order: { id: ... } } })`
// can filter by link existence. Index for list filtering; query.graph for
// authoritative transactional reads (see order-production-run.ts).
//
// Managed link → fully BIDIRECTIONAL in query.graph: forward
// `inventory_orders.order`, reverse `order.inventory_orders` (auto-derived
// PLURAL). The `field` below only adds the singular `inventory_order` alias to
// the Index Module; it does NOT rename query.graph's reverse accessor.
export default defineLink(
  OrderModule.linkable.order,
  {
    linkable: InventoryOrderModule.linkable.inventoryOrders,
    filterable: ["id"],
    // adds the singular `inventory_order` alias to the INDEX (query.index) for
    // the retail anti-join. Does NOT change query.graph's reverse accessor
    // (that's `order.inventory_orders`).
    field: "inventory_order",
  }
)
