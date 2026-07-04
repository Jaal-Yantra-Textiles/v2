import { defineLink } from "@medusajs/framework/utils"
import InventoryOrdersModule from "../modules/inventory_orders"
import FullfilledOrdersModule from "../modules/fullfilled_orders"

// An inventory order's carrier shipments (#772 follow-up). One order can ship
// in multiple consignments (partial completions, cancel-and-recreate), so both
// sides are lists — mirrors fullfilled-orders-orders.ts.
export default defineLink(
  { linkable: InventoryOrdersModule.linkable.inventoryOrders, isList: true },
  { linkable: FullfilledOrdersModule.linkable.inventoryShipment, isList: true }
)
