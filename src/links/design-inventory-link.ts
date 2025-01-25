

import { defineLink } from "@medusajs/framework/utils"
import DesignModule from "../modules/designs"
import InventoryModule from "@medusajs/medusa/inventory"

export default defineLink(
    DesignModule.linkable.design,
    {
      linkable: InventoryModule.linkable.inventoryItem,
      isList: true,
    }
  )