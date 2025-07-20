import { defineLink } from "@medusajs/framework/utils"
import PartnerModule from "../modules/partner"
import InventoryOrderModule from "../modules/inventory_orders"

export default defineLink(
    PartnerModule.linkable.partner,
    {
        linkable: InventoryOrderModule.linkable.inventoryOrders,
        isList: true,
        field: 'inventory_orders'
    }
)
