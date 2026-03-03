import { defineLink } from "@medusajs/framework/utils"
import InboundEmailModule from "../modules/inbound_emails"
import InventoryOrdersModule from "../modules/inventory_orders"

export default defineLink(
  {
    linkable: InboundEmailModule.linkable.inboundEmail,
    isList: true,
  },
  {
    linkable: InventoryOrdersModule.linkable.inventoryOrders,
    isList: true,
  }
)
