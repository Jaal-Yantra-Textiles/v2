import { model } from "@medusajs/framework/utils";
import Design from "./design";

const DesignSpecification = model.define("design_specifications", {
  id: model.id().primaryKey(),
  title: model.text(),
  category: model.enum([
    "Measurements",
    "Materials",
    "Construction",
    "Finishing",
    "Packaging",
    "Quality",
    "Other"
  ]),
  details: model.text(),
  measurements: model.json().nullable(), // For storing size-specific measurements
  materials_required: model.json().nullable(), // List of required materials
  special_instructions: model.text().nullable(),
  attachments: model.json().nullable(), // URLs to specification documents
  version: model.text(), // For tracking specification versions
  status: model.enum([
    "Draft",
    "Under_Review",
    "Approved",
    "Rejected",
    "Needs_Revision"
  ]).default("Draft"),
  reviewer_notes: model.text().nullable(),
  metadata: model.json().nullable(),
  
  // Relationship with Design
  design: model.belongsTo(() => Design, { mappedBy: "specifications" }),
});

export default DesignSpecification;
