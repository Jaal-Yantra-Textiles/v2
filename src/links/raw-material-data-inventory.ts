import { defineLink } from "@medusajs/framework/utils";
import InventoryModule from "@medusajs/medusa/inventory";
import RawMaterialModule from "../modules/raw_material";

export default defineLink(
 {
   linkable: InventoryModule.linkable.inventoryItem,
 },
 RawMaterialModule.linkable.rawMaterials
)