import { model } from "@medusajs/framework/utils";
import DesignSpecification from "./design_specification";
import DesignColor from "./design_color";
import DesignSizeSet from "./design_size_set";
import DesignComponent from "./design_component";

const Design = model.define("design", {
  id: model.id().primaryKey(),
  name: model.text().searchable(),
  description: model.text(),
  inspiration_sources: model.json().nullable(), // Array of inspiration URLs or references
  design_type: model.enum([
    "Original",
    "Derivative",
    "Custom",
    "Collaboration"
  ]).default("Original"),
  status: model.enum([
    "Conceptual",
    "In_Development",
    "Technical_Review",
    "Sample_Production",
    "Revision",
    "Approved",
    "Rejected",
    "On_Hold",
    "Commerce_Ready",
    "Superseded"
  ]).default("Conceptual"),
  priority: model.enum([
    "Low",
    "Medium",
    "High",
    "Urgent"
  ]).default("Medium"),
  origin_source: model.enum([
    "manual",
    "ai-mistral",
    "ai-other",
  ]).default("manual"),
  target_completion_date: model.dateTime().nullable(),
  design_files: model.json().nullable(), // URLs to design files
  thumbnail_url: model.text().nullable(),
  custom_sizes: model.json().nullable(), // Custom size specifications
  color_palette: model.json().nullable(), // Color codes and names
  tags: model.json().nullable(), // For categorization and searching
  estimated_cost: model.bigNumber().nullable(),
  material_cost: model.bigNumber().nullable(),
  production_cost: model.bigNumber().nullable(),
  cost_breakdown: model.json().nullable(), // Structured: { items: [{ inventory_item_id, title, quantity, unit_cost, line_total, cost_source }], calculated_at, source }
  cost_currency: model.text().nullable(), // e.g. "inr"
  designer_notes: model.text().nullable(),
  feedback_history: model.json().nullable(), // Track feedback and changes
  revised_from_id: model.text().nullable(),
  revision_number: model.number().default(1),
  revision_notes: model.text().nullable(),
  metadata: model.json().nullable(),
  media_files: model.json().nullable(),
  moodboard: model.json().nullable(),
  // Relationships
  specifications: model.hasMany(() => DesignSpecification, { mappedBy: "design" }),
  colors: model.hasMany(() => DesignColor, { mappedBy: "design" }),
  size_sets: model.hasMany(() => DesignSizeSet, { mappedBy: "design" }),
  // Bundle/composite relationships
  components: model.hasMany(() => DesignComponent, { mappedBy: "parent_design" }),
  used_in: model.hasMany(() => DesignComponent, { mappedBy: "component_design" }),
}).cascades({
  delete: ['specifications', 'colors', 'size_sets', 'components', 'used_in']
});

export default Design;
