import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { buildMoodboardScene } from "../../../../../../workflows/designs/moodboard/build-moodboard-scene"
import { saveDesignMoodboardWorkflow } from "../../../../../../workflows/designs/moodboard/save-design-moodboard"
import {
  loadDesignForMoodboard,
  REFRESH_SCENE_OPTS,
} from "../../../../../../workflows/designs/moodboard/seed-design-moodboard"
import {
  assessTechPackCompleteness,
  buildTechPackInputFromDesign,
} from "../../../../../../workflows/designs/moodboard/techpack-input-from-design"

/**
 * POST /admin/designs/:id/moodboard/generate
 *
 * Seeds the design's moodboard with a freshly-built AI tech-pack scene (#892):
 * loads the design's structured data (header/flats/size-set/colorways + Construction
 * specs → construction details), runs the deterministic scene builder, persists the
 * result to the design's CORE board, and returns it.
 *
 * 🔴 The write target is the core board ROW, not `design.moodboard` (#2017).
 * While this wrote the column and the editor wrote the row, a generate on any
 * migrated design landed somewhere nothing reads — every surface prefers the
 * row and ignores the blob the moment one exists, so the button did nothing
 * visible and reported success.
 *
 * This REPLACES any existing moodboard — it's a seed/regenerate action, not a merge.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const designId = req.params.id

  // Shared loader → design columns + pinned material groups (#1113 parity).
  const design = await loadDesignForMoodboard(req.scope, designId)

  const input = buildTechPackInputFromDesign(design)

  // Don't generate a hollow tech-pack: a design needs measurements + at least one
  // construction detail before a scene is worth building (#892).
  const completeness = assessTechPackCompleteness(input)
  if (!completeness.ok) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Design "${design.name ?? designId}" is missing ${completeness.missing.join(
        " and "
      )}. Add these to the design before generating a tech-pack.`
    )
  }

  // Index the board + include the Design Specs / Materials reference frames, but
  // not the workspace scaffold (this is a replace/regenerate, not a first seed).
  const scene = buildMoodboardScene(input, REFRESH_SCENE_OPTS)

  const { errors } = await saveDesignMoodboardWorkflow(req.scope).run({
    input: { designId, owner: { type: "core" }, scene },
  })
  if (errors?.length > 0) {
    throw errors[0].error
  }

  res.json({ moodboard: scene })
}
