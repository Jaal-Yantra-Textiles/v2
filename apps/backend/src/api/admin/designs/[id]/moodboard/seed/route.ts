import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { seedDesignMoodboardIfEmpty } from "../../../../../../workflows/designs/moodboard/seed-design-moodboard"

/**
 * POST /admin/designs/:id/moodboard/seed
 *
 * Idempotent, brief-friendly seed for the admin moodboard editor. Builds the
 * brief (+ any tech-pack) frames and persists them to `design.moodboard` ONLY
 * when the board is currently empty — so opening a fresh design's moodboard in
 * the admin shows an editable, Figma-style snapshot without a manual click, and
 * never clobbers an already-authored board.
 *
 * Unlike `.../moodboard/generate` (which replaces and hard-gates on tech-pack
 * completeness, #892), this is a no-throw prep step: a design with nothing to
 * render yet just returns `{ moodboard: null }`.
 */
export const POST = async (
  req: MedusaRequest & { params: { id: string } },
  res: MedusaResponse
) => {
  const moodboard = await seedDesignMoodboardIfEmpty(req.scope, req.params.id)
  res.json({ moodboard })
}
