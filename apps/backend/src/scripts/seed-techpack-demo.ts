import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { DESIGN_MODULE } from "../modules/designs"

/**
 * Seeds a fully-populated demo design for exercising the #892 tech-pack generator.
 *
 * The moodboard generator is data-gated: it only builds the Measurements /
 * Construction / Colorways frames when the design actually has a size set /
 * Construction specs / color palette. A bare design yields only the always-on
 * "Header & Flats" frame. This script creates a design with all three so a
 * "Generate tech-pack" run in the admin shows every frame.
 *
 * Run:  npx medusa exec ./src/scripts/seed-techpack-demo.ts
 */
export default async function seedTechpackDemo({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const designService: any = container.resolve(DESIGN_MODULE)

  const design = await designService.createDesigns({
    name: "Tech-Pack Demo — Craft Revival Top",
    description: "Handloom top with neckline embroidery (tech-pack demo)",
    design_type: "Original",
    status: "Conceptual",
    priority: "High",
    thumbnail_url: "https://placehold.co/600x800/png?text=FRONT",
    color_palette: [
      { name: "Natural / Indigo", hex_code: "#2e3a59", thread_ref: "K-7" },
      { name: "Natural / Madder", hex_code: "#a83232", thread_ref: "K-10" },
      { name: "Natural / Myrobalan", hex_code: "#c9a227", thread_ref: "K-14" },
    ],
    metadata: {
      style_code: "SS26-CR-TP-08",
      season: "SS26",
      category: "Womenswear / Top",
      capsule: "Craft Revival",
      garment_type: "blouse",
      flats: { back_image_url: "https://placehold.co/600x800/png?text=BACK" },
    },
  })

  await designService.createDesignSizeSets({
    design_id: design.id,
    size_label: "M",
    measurements: {
      total_length_hps: 66,
      shoulder_across: 38,
      neck_width: 24,
      neck_drop: 12,
      sleeve_length: 62,
      hem_opening: 160,
    },
  })

  await designService.createDesignSpecifications([
    {
      design_id: design.id,
      title: "Sleeve-head gathers",
      category: "Construction",
      details: "1.6x ease onto armhole",
      special_instructions: "ease onto armhole; press toward sleeve",
      version: "1",
      metadata: {
        technique: "gathers",
        params: { ratio: 1.6 },
        fabricRules: ["ease onto armhole", "press toward sleeve"],
      },
    },
    {
      design_id: design.id,
      title: "Waist dart",
      category: "Construction",
      details: "single-point waist shaping",
      version: "1",
      metadata: {
        technique: "dart",
        params: { intake: 0.6 },
        fabricRules: ["press toward CF", "clip at apex"],
      },
    },
    {
      design_id: design.id,
      title: "Hem knife pleats",
      category: "Construction",
      details: "5 knife pleats at hem",
      version: "1",
      metadata: {
        technique: "knife-pleat",
        params: { count: 5 },
        fabricRules: ["press all one direction"],
      },
    },
    {
      design_id: design.id,
      title: "Collar topstitch",
      category: "Construction",
      details: "double-row topstitch, 6mm from edge",
      version: "1",
      metadata: { technique: "topstitch", params: { rows: 2 } },
    },
    {
      design_id: design.id,
      title: "Neckline embroidery",
      category: "Construction",
      details: "flower motif, 2-2.5cm wide",
      version: "1",
      metadata: { technique: "embroidery", params: { motif: 6 } },
    },
  ])

  logger.info(`✓ Seeded tech-pack demo design: ${design.id}`)
  logger.info(`  Open: /app/designs/${design.id} → Edit Moodboard → Generate tech-pack`)
}
