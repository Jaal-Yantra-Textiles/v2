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
export default defineLink(
  OrderModule.linkable.order,
  {
    linkable: InventoryOrderModule.linkable.inventoryOrders,
    filterable: ["id"],
    // pin the relation name so the filter key is `inventory_order` (singular).
    field: "inventory_order",
  }
)
