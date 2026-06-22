import { model } from "@medusajs/framework/utils";
import DesignSpecification from "./design_specification";
import DesignColor from "./design_color";
import DesignSizeSet from "./design_size_set";
import DesignComponent from "./design_component";

const Design = model.define("design", {
  id: model.id().primaryKey(),
  name: model.text().searchable().translatable(),
  description: model.text().translatable(),
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
  designer_notes: model.text().translatable().nullable(),
  // Design brief / collection concept (roadmap #604).
  // Section 1 (Core Identity): a short story/title distinct from the longer
  // free-text `description` ("90s Tokyo Streetwear").
  concept_theme: model.text().translatable().nullable(),
  // Section 2 (Target Audience & Market Positioning) — JSON value objects,
  // read+written as a whole through the design update route (NOT independently
  // mutated rows, NOT metadata, so the metadata-replace hazard does not apply).
  persona: model.json().nullable(),        // { age_range, lifestyle, values[], pain_points[] }
  competitors: model.json().nullable(),    // [{ name, url?, differentiator }]
  price_point: model.enum([
    "luxury",
    "mid_market",
    "budget",
  ]).nullable(),                           // positioning tier, distinct from the *_cost budget fields
  // Section 3 (Timeline & Budget) — the design-phase budget, deliberately
  // separate from material/production manufacturing cost. Reuses cost_currency.
  design_budget: model.bigNumber().nullable(),
  feedback_history: model.json().nullable(), // Track feedback and changes
  revised_from_id: model.text().nullable(),
  revision_number: model.number().default(1),
  revision_notes: model.text().translatable().nullable(),
  // Partner self-serve (roadmap #6): when a partner CREATES a design
  // for their own pipeline, this is set to their partner id. Admin-
  // created designs leave it null. Used to (a) exclude partner-owned
  // designs from the global admin design list by default, and (b)
  // guard partner edit/delete to the owning partner. Visibility to the
  // owning partner still flows through design_partners_link as usual.
  owner_partner_id: model.text().nullable(),
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
