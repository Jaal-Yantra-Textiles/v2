import { model } from "@medusajs/framework/utils";
import MaterialType from "./material_type";
import RawMaterial from "./raw_material";

/**
 * The "product" parent that ties per-color raw_material rows together as one
 * logical material (e.g. "Cotton Poplin", available in blue / red / green).
 *
 * Each color is a `raw_material` row (the "variant") with `group_id` set here,
 * carrying its own SKU + inventory_item + stock. The group holds the shared
 * specs so "browse / order all colors of Material A" is expressible.
 */
const RawMaterialGroup = model.define("raw_material_group", {
  id: model.id().primaryKey(),
  name: model.text().searchable().translatable(),
  description: model.text().translatable().nullable(),
  composition: model.text().translatable().nullable(), // shared, e.g. "100% Cotton"
  specifications: model.json().nullable(), // shared technical specifications
  // Operator-defined variant axes this group varies its members along. `color`
  // is the built-in, always-present axis (kept as a first-class column on the
  // member for display/denorm); `dimensions` lets a group declare additional
  // axes later (finish, pattern, size, …) WITHOUT a schema change — each entry
  // is { key, label, values? }. Empty/null ⇒ color-only (today's behavior).
  dimensions: model.json().nullable(),
  unit_of_measure: model.enum([
    "Meter",
    "Yard",
    "Kilogram",
    "Gram",
    "Piece",
    "Roll",
    "Other"
  ]).default("Other"),
  // #829 — shared "global" specs a group sets once; new per-color raw_materials
  // inherit these (fill-blank) when quick-added / created. width/weight/grade are
  // intentionally NOT here (they can differ per dye lot / color).
  unit_cost: model.float().nullable(),
  cost_currency: model.text().nullable(),
  lead_time_days: model.number().nullable(),
  minimum_order_quantity: model.number().nullable(),
  // Default receiving stock location for the group's colors (set once).
  stock_location_id: model.text().nullable(),
  status: model.enum([
    "Active",
    "Discontinued",
    "Under_Review",
    "Development"
  ]).default("Active"),
  metadata: model.json().nullable(),
  media: model.json().nullable(),
  // Shared taxonomy for the whole group of colors.
  material_type: model.belongsTo(() => MaterialType, { mappedBy: "raw_material_groups" }).nullable(),
  // The per-color "variant" rows.
  raw_materials: model.hasMany(() => RawMaterial, { mappedBy: "group" }),
});

export default RawMaterialGroup;
