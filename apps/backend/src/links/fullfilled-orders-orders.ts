import { defineLink } from "@medusajs/framework/utils"
import InventoryOrdersModule from "../modules/inventory_orders"
import FullfilledOrdersModule from "../modules/fullfilled_orders"

// Optional convenience link: inventory orders to their fulfillment entries
// One order can have many fulfillment entries (across its lines)
export default defineLink(
  { linkable: InventoryOrdersModule.linkable.inventoryOrders, isList: true },
  { linkable: FullfilledOrdersModule.linkable.lineFulfillment, isList: true }
)
