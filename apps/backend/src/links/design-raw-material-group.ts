import { defineLink } from "@medusajs/framework/utils"
import DesignModule from "../modules/designs"
import RawMaterialModule from "../modules/raw_material"

/**
 * #817 S4 — let a design pin one or more raw_material_groups (its material
 * palette at the group grain). The color stays unresolved until production,
 * where `resolved_raw_material_id` records which specific color variant was
 * chosen (consumption still targets a concrete inventory_item = one color).
 */
export default defineLink(
  { linkable: DesignModule.linkable.design, isList: true },
  { linkable: RawMaterialModule.linkable.rawMaterialGroup, isList: true },
  {
    database: {
      extraColumns: {
        // The color chosen at production time (a raw_material in the group).
        resolved_raw_material_id: { type: "text", nullable: true },
        note: { type: "text", nullable: true },
        metadata: { type: "json", nullable: true },
      },
    },
  }
)
