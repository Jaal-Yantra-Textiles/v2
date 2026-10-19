import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { toStoryTeaser } from "../../production-story-lib/build-story"
import { loadDesignStory } from "../../production-story-lib/load-story"

/**
 * GET /store/custom/designs/:id/production-story
 *
 * PUBLIC, read-only "how this was made" story for a design. Mirrors the
 * public exposure already granted to product → designs.* on /store/products,
 * so no customer auth is required. Returns a TEASER (`toStoryTeaser`): first
 * and last step, maker partners, raw materials, run status. The full story
 * (every step, people, energy) goes only by email via `./share`.
 *
 * Production runs link to a design by the flat `production_run.design_id`
 * column (NOT a module link), so they're fetched by design_id directly rather
 * than via a `designs.*` relation field path.
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    const designId = req.params.id
    const loaded = await loadDesignStory(req.scope, designId)
    if (!loaded) {
      res.status(404).json({ message: "Design not found" })
      return
    }

    res.status(200).json({ production_story: toStoryTeaser(loaded.production_story) })
  } catch (error) {
    logger.error("[Store] Error building production story:", error as Error)
    res.status(500).json({
      message: "Failed to build production story",
      error: error instanceof Error ? error.message : "Unknown error",
    })
  }
}
