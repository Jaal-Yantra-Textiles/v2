

import { defineLink } from "@medusajs/framework/utils"
import DesignModule from "../modules/designs"
import InventoryModule from "@medusajs/medusa/inventory"

export default defineLink(
  { linkable: DesignModule.linkable.design, isList: true },
  { linkable: InventoryModule.linkable.inventoryItem, isList: true },
  {
    database: {
      extraColumns: {
        planned_quantity: { type: "bigint", nullable: true },
        consumed_quantity: { type: "bigint", nullable: true },
        consumed_at: { type: "datetime", nullable: true },
        location_id: { type: "text", nullable: true },
        metadata: { type: "json", nullable: true },
      },
    },
  }
)