import { model } from "@medusajs/framework/utils";

const MaterialType = model.define("material_types", {
  id: model.id().primaryKey(),
  name: model.text().searchable().translatable(),
  description: model.text().translatable().nullable(),
  category: model.enum([
    "Fiber",
    "Yarn",
    "Fabric",
    "Trim",
    "Dye",
    "Chemical",
    "Accessory",
    "Other"
  ]).default("Other"),
  properties: model.json().nullable(), // Additional properties specific to the type
  metadata: model.json().nullable(),
});

export default MaterialType;
