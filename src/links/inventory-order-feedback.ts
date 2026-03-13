import { defineLink } from "@medusajs/framework/utils"
import InventoryOrderModule from "../modules/inventory_orders"
import FeedbackModule from "../modules/feedback"

export default defineLink(
    { linkable: InventoryOrderModule.linkable.inventoryOrders, isList: true },
    { linkable: FeedbackModule.linkable.feedback, isList: true }
)
