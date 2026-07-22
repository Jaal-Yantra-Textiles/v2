import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import {
  buildMoodboardBlock,
  listMoodboardBlocks,
} from "../../../../../../workflows/designs/moodboard/build-moodboard-scene"
import { loadDesignForMoodboard } from "../../../../../../workflows/designs/moodboard/seed-design-moodboard"
import { buildTechPackInputFromDesign } from "../../../../../../workflows/designs/moodboard/techpack-input-from-design"
import { assertPartnerCanAuthorDesign } from "../../../helpers"

/**
 * GET /partners/designs/:designId/moodboard/blocks
 *
 * The insert-block palette (#1113 S3+): lists every drop-in frame the designer
 * can insert on the canvas, flagging which ones the design currently has data
 * for. Owner OR assigned/invited designer.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest & { params: { designId: string } },
  res: MedusaResponse
) => {
  const designId = req.params.designId
  await assertPartnerCanAuthorDesign(req, designId)

  const design = await loadDesignForMoodboard(req.scope, designId)
  const input = buildTechPackInputFromDesign(design)
  res.json({ blocks: listMoodboardBlocks(input) })
}

/**
 * POST /partners/designs/:designId/moodboard/blocks  { block: "<key>" }
 *
 * Build ONE block from the design's current data, positioned at origin. Does
 * NOT persist — the partner-ui translates + re-ids the returned elements onto
 * the live Excalidraw scene, then the designer arranges and saves via the
 * existing author-scoped moodboard PUT. This is the "drop-in element" path that
 * bypasses the monolithic Generate.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest & { params: { designId: string } },
  res: MedusaResponse
) => {
  const designId = req.params.designId
  await assertPartnerCanAuthorDesign(req, designId)

  const key = (req.body as { block?: unknown } | undefined)?.block
  if (typeof key !== "string" || !key.trim()) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Missing 'block' — pass the key of the block to insert."
    )
  }

  const design = await loadDesignForMoodboard(req.scope, designId)
  const input = buildTechPackInputFromDesign(design)
  const block = buildMoodboardBlock(input, key)
  if (!block) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Unknown block '${key}'.`
    )
  }

  res.json({ block })
}
