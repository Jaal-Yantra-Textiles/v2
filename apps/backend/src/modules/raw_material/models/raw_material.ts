import { model } from "@medusajs/framework/utils";
import MaterialType from "./material_type";
import RawMaterialGroup from "./raw_material_group";

const RawMaterial = model.define("raw_materials", {
  id: model.id().primaryKey(),
  name: model.text().searchable().translatable(),
  description: model.text().translatable(),
  composition: model.text().translatable(), // e.g., "100% Cotton", "80% Polyester 20% Cotton"
  specifications: model.json().nullable(), // Technical specifications
  unit_of_measure: model.enum([
    "Meter",
    "Yard",
    "Kilogram",
    "Gram",
    "Piece",
    "Roll",
    "Other"
  ]).default("Other"),
  unit_cost: model.float().nullable(), // Cost per unit of measure
  cost_currency: model.text().nullable(), // e.g. "inr", "usd"
  minimum_order_quantity: model.number().nullable(),
  lead_time_days: model.number().nullable(),
  color: model.text().nullable(),
  // Generic per-member variant coordinates keyed by the parent group's
  // `dimensions` (e.g. { color: "Blue", finish: "Matte" }). `color` above stays
  // the canonical display/denorm key; `attributes` is additive room for new axes
  // introduced on the group later — no migration required to add an axis.
  attributes: model.json().nullable(),
  width: model.text().nullable(), // For fabrics and similar materials
  weight: model.text().nullable(), // Weight per unit
  grade: model.text().nullable(),
  certification: model.json().nullable(), // Any certifications the material has
  usage_guidelines: model.text().translatable().nullable(),
  storage_requirements: model.text().translatable().nullable(),
  status: model.enum([
    "Active",
    "Discontinued",
    "Under_Review",
    "Development"
  ]).default("Active"),
  metadata: model.json().nullable(),
  media: model.json().nullable(),
  // Relationship with MaterialType
  material_type: model.belongsTo(() => MaterialType, { mappedBy: "raw_materials" }).nullable(),
  // Parent group tying this color to its sibling colors (nullable: existing rows stay ungrouped).
  group: model.belongsTo(() => RawMaterialGroup, { mappedBy: "raw_materials" }).nullable(),
});

export default RawMaterial;
