import { defineLink } from "@medusajs/framework/utils"
import InventoryOrdersModule from "../modules/inventory_orders"
import FullfilledOrdersModule from "../modules/fullfilled_orders"

// Link inventory order lines to their fulfillment entries
// One order line can have many fulfillment entries; each fulfillment entry belongs to one order line.
export default defineLink(
  { linkable: InventoryOrdersModule.linkable.inventoryOrderLine, isList: true },
  { linkable: FullfilledOrdersModule.linkable.lineFulfillment, isList: true }
)
