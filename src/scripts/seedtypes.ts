// src/scripts/seedtypes.ts
import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { createPersonTypeWorkflow } from "../workflows/person_type/create-person_type";
import { createTaskTemplateWorkflow } from "../workflows/task-templates/create-template";

export default async function seedTypes({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

  // Seed Textile Person Types
  logger.info("Seeding person type data...");
  const personTypes = [
    { name: "Textile Designer", description: "Defines fabric patterns, selects color palettes and textures." },
    { name: "Weaving Technician", description: "Configures and operates looms to weave fabrics." },
    { name: "Dyeing Technician", description: "Prepares and runs dye baths; matches color recipes." },
    { name: "Quality Inspector", description: "Examines fabrics for defects, measures specs and reports issues." },
    { name: "Production Supervisor", description: "Oversees the end-to-end textile production process." },
  ];
  for (const pt of personTypes) {
    await createPersonTypeWorkflow(container).run({ input: pt });
  }

  // Seed Textile Task Templates
  logger.info("Seeding task template data...");
  const taskTemplates = [
    {
      name: "Design Fabric Pattern",
      description: "Create initial fabric pattern based on brief",
      priority: "medium" as const,
      estimated_duration: 960,
      required_fields: {
        pattern_name: { type: "string", required: true },
        dimensions: { type: "string", required: true },
        color_palette: { type: "string", required: true },
        reference_images: { type: "string", required: true },
      },
      eventable: true,
      notifiable: true,
      category: "Design",
    },
    {
      name: "Approve Color Matching",
      description: "Review sample against color standards and approve",
      priority: "high" as const,
      estimated_duration: 240,
      required_fields: {
        sample_id: { type: "string", required: true },
        color_reference: { type: "string", required: true },
        approval_status: { type: "enum", options: ["approved", "rework"], required: true },
      },
      eventable: true,
      notifiable: true,
      category: "Design",
    },
    {
      name: "Setup Weaving Loom",
      description: "Configure loom settings for target fabric specs",
      priority: "medium" as const,
      estimated_duration: 480,
      required_fields: {
        loom_id: { type: "string", required: true },
        warp_thread: { type: "string", required: true },
        weft_thread: { type: "string", required: true },
        tension_settings: { type: "object", required: true },
      },
      eventable: true,
      notifiable: true,
      category: "Production",
    },
    {
      name: "Weave Fabric Batch",
      description: "Execute weaving run according to pattern specs",
      priority: "high" as const,
      estimated_duration: 1440,
      required_fields: {
        batch_number: { type: "string", required: true },
        width_cm: { type: "number", required: true },
        length_m: { type: "number", required: true },
      },
      eventable: true,
      notifiable: true,
      category: "Production",
    },
    {
      name: "Perform Dyeing Process",
      description: "Dye fabric batch following color recipe",
      priority: "high" as const,
      estimated_duration: 960,
      required_fields: {
        batch_number: { type: "string", required: true },
        dye_recipe: { type: "object", required: true },
        water_temp_c: { type: "number", required: true },
        process_duration_min: { type: "number", required: true },
      },
      eventable: true,
      notifiable: true,
      category: "Production",
    },
    {
      name: "Inspect Fabric Quality",
      description: "Check for defects, measure tolerances, log findings",
      priority: "high" as const,
      estimated_duration: 360,
      required_fields: {
        sample_id: { type: "string", required: true },
        defect_report: { type: "text", required: true },
        measurements: { type: "object", required: true },
      },
      eventable: true,
      notifiable: true,
      category: "Quality Assurance",
    },
    {
      name: "Package Fabric Rolls",
      description: "Pack, label and prepare for shipment",
      priority: "low" as const,
      estimated_duration: 240,
      required_fields: {
        roll_id: { type: "string", required: true },
        packaging_type: { type: "string", required: true },
        label_details: { type: "string", required: true },
      },
      eventable: true,
      notifiable: true,
      category: "Logistics",
    },
  ];

  for (const tt of taskTemplates) {
    await createTaskTemplateWorkflow(container).run({ input: tt });
  }
}
