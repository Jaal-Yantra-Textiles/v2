import { model } from "@medusajs/framework/utils";
import DesignSpecification from "./design_specification";

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
    "Commerce_Ready"
  ]).default("Conceptual"),
  priority: model.enum([
    "Low",
    "Medium",
    "High",
    "Urgent"
  ]).default("Medium"),
  target_completion_date: model.dateTime().nullable(),
  design_files: model.json().nullable(), // URLs to design files
  thumbnail_url: model.text().nullable(),
  custom_sizes: model.json().nullable(), // Custom size specifications
  color_palette: model.json().nullable(), // Color codes and names
  tags: model.json().nullable(), // For categorization and searching
  estimated_cost: model.bigNumber().nullable(),
  designer_notes: model.text().nullable(),
  feedback_history: model.json().nullable(), // Track feedback and changes
  metadata: model.json().nullable(),
  media_files: model.json().nullable(),
  moodboard: model.json().nullable(),
  // Relationships
  specifications: model.hasMany(() => DesignSpecification, { mappedBy: "design" }),
}).cascades({
  delete: ['specifications']
});

export default Design;
