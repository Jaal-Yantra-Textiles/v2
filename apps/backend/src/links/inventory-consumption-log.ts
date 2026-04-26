import { defineLink } from "@medusajs/framework/utils"
import InventoryModule from "@medusajs/medusa/inventory"
import ConsumptionLogModule from "../modules/consumption_log"

export default defineLink(
  InventoryModule.linkable.inventoryItem,
  {
    linkable: ConsumptionLogModule.linkable.consumptionLog,
    isList: true,
  }
)
