import { defineLink } from "@medusajs/framework/utils"
import InventoryOrdersModule from "../modules/inventory_orders"
import WorkOrderModule from "../modules/work_orders"

// #2262 S0 — READ-ONLY: `work_order.inventory_order_id` → the inventory order an
// inventory work order IS. 1:1, so an id column, not a pivot table.
export default defineLink(
  { linkable: WorkOrderModule.linkable.workOrder, field: "inventory_order_id" },
  InventoryOrdersModule.linkable.inventoryOrders,
  { readOnly: true }
)
