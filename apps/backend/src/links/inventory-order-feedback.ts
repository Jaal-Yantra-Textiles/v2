import { defineLink } from "@medusajs/framework/utils"
import InventoryOrderModule from "../modules/inventory_orders"
import FeedbackModule from "../modules/feedback"

export default defineLink(
    { linkable: InventoryOrderModule.linkable.inventoryOrders, isList: true, filterable: ["id", "status", "order_number"] },
    { linkable: FeedbackModule.linkable.feedback, isList: true, filterable: ["id", "rating", "status", "submitted_at"] }
)
