

import { defineLink } from "@medusajs/framework/utils"
import DesignModule from "../modules/designs"
import InventoryModule from "@medusajs/medusa/inventory"

export default defineLink(
  { linkable: DesignModule.linkable.design, isList: true },
  { linkable: InventoryModule.linkable.inventoryItem, isList: true },
  {
    database: {
      extraColumns: {
        /**
         * 🔴 `type: "decimal"` alone lands as `numeric(10,0)` — scale ZERO, the
         * defect already fixed on the run↔inventory link (#1548). Cloth is
         * planned in metres: 2.7 m of leftover after a robe was stored as 3
         * (#2315). Migration20260930120000 widens existing databases.
         */
        planned_quantity: {
          type: "decimal",
          nullable: true,
          options: { columnType: "numeric(20,6)" },
        },
        consumed_quantity: {
          type: "decimal",
          nullable: true,
          options: { columnType: "numeric(20,6)" },
        },
        consumed_at: { type: "datetime", nullable: true },
        location_id: { type: "text", nullable: true },
        metadata: { type: "json", nullable: true },
      },
    },
  }
)