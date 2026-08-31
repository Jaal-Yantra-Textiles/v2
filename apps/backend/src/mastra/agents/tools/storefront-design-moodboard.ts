/**
 * save_moodboard — inspiration elements for the chat design editor.
 *
 * Appends the maker's uploaded reference images into the Excalidraw scene on
 * design.moodboard as inspiration elements (customData.source = "inspiration").
 * The shop's scene panel renders them read-only; generation reads them as
 * moodboard references (initial canvases reference the product image + these).
 *
 * For NEW designs the generate tool seeds inspirations at creation — this tool
 * serves editing an existing design's board.
 */
import type { MedusaContainer } from "@medusajs/framework"
import { tool } from "ai"
import { z } from "zod"
import type DesignService from "../../../modules/designs/service"
import { DESIGN_MODULE } from "../../../modules/designs"
import { normalizeCanvasScene, type CanvasScene } from "../../../modules/designs/lib/canvas-scene"
import { analyzeReferenceImages } from "./storefront-design-analysis"

const resolveDesignService = (container: MedusaContainer): DesignService =>
  container.resolve(DESIGN_MODULE) as unknown as DesignService

export const runSaveMoodboard = async (
  container: MedusaContainer,
  designId: string,
  inspirationImages: string[]
): Promise<{ added: number }> => {
  const designService = resolveDesignService(container)
  const design = await designService.retrieveDesign(designId).catch(() => null)
  if (!design) {
    throw new Error(`Design ${designId} not found or not accessible.`)
  }

  // Analyse the references on the fly — the vision result is stamped onto the
  // media's metadata AND onto each inspiration element so later turns read a
  // grounded description instead of paying for another vision call.
  const analyses = await analyzeReferenceImages(container, inspirationImages)

  const scene = normalizeCanvasScene(design.moodboard)
  for (const url of inspirationImages) {
    const fileId = `insp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const analysis = analyses.get(url)
    scene.files[fileId] = {
      id: fileId,
      dataURL: url,
      mimeType: "image/png",
      created: Date.now(),
      lastRetrieved: Date.now(),
    }
    scene.elements.push({
      id: `el-${fileId}`,
      type: "image",
      x: 40 + (scene.elements.length % 2) * 300,
      y: 40 + Math.floor(scene.elements.length / 2) * 300,
      width: 260,
      height: 260,
      angle: 0,
      strokeColor: "transparent",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      roundness: null,
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      link: url,
      locked: true,
      fileId,
      mimeType: "image/png",
      customData: {
        source: "inspiration",
        ...(analysis
          ? {
              media_id: analysis.media_id,
              analysis: {
                title: analysis.title,
                description: analysis.description,
                suggestions: analysis.suggestions,
                analyzed_at: analysis.analyzed_at,
              },
            }
          : {}),
      },
    })
  }

  await designService.updateDesigns({
    id: designId,
    moodboard: scene as unknown as Record<string, unknown>,
  })

  return { added: inspirationImages.length }
}

const SaveMoodboardSchema = z.object({
  design_id: z.string().describe("The design whose board gets the inspirations."),
  inspiration_images: z
    .array(z.string().url().max(2000))
    .min(1)
    .max(8)
    .describe("Uploaded reference image URLs (persistent http URLs from the uploads API)."),
})

export const createSaveMoodboardTool = (container: MedusaContainer) =>
  tool({
    description:
      "Add the maker's uploaded reference images to the design board as inspirations. Call this when they upload moodboard references for an existing design — they render on the board and shape generation.",
    inputSchema: SaveMoodboardSchema,
    execute: async (args) =>
      runSaveMoodboard(container, args.design_id, args.inspiration_images),
  })
