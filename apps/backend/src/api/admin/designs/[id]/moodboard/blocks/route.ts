import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import {
  buildMoodboardBlock,
  listMoodboardBlocks,
} from "../../../../../../workflows/designs/moodboard/build-moodboard-scene"
import { loadDesignForMoodboard } from "../../../../../../workflows/designs/moodboard/seed-design-moodboard"
import { buildTechPackInputFromDesign } from "../../../../../../workflows/designs/moodboard/techpack-input-from-design"

/**
 * Admin mirror of the partner insert-block palette (#1113 Feature A).
 * GET lists the drop-in blocks (with data-availability flags); POST builds one
 * block from the design's current data at origin. Not persisted — the admin
 * editor translates + re-ids the elements onto the live canvas, then saves.
 */
export const GET = async (
  req: MedusaRequest & { params: { id: string } },
  res: MedusaResponse
) => {
  const design = await loadDesignForMoodboard(req.scope, req.params.id)
  const input = buildTechPackInputFromDesign(design)
  res.json({ blocks: listMoodboardBlocks(input) })
}

export const POST = async (
  req: MedusaRequest & { params: { id: string } },
  res: MedusaResponse
) => {
  const key = (req.body as { block?: unknown } | undefined)?.block
  if (typeof key !== "string" || !key.trim()) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Missing 'block' — pass the key of the block to insert."
    )
  }

  const design = await loadDesignForMoodboard(req.scope, req.params.id)
  const input = buildTechPackInputFromDesign(design)
  const block = buildMoodboardBlock(input, key)
  if (!block) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `Unknown block '${key}'.`)
  }

  res.json({ block })
}
