import { model } from "@medusajs/framework/utils";

const IsInventoryRawMaterial = model.define("is_inventory_raw_materials", {
  id: model.id().primaryKey(),
  is_raw_material: model.boolean().default(false),
});

export default IsInventoryRawMaterial;
