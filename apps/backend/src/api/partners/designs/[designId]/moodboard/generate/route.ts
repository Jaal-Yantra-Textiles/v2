import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { updateDesignWorkflow } from "../../../../../../workflows/designs/update-design"
import {
  buildDesignMoodboard,
  REFRESH_SCENE_OPTS,
} from "../../../../../../workflows/designs/moodboard/seed-design-moodboard"
import { assertPartnerCanAuthorDesign } from "../../../helpers"

/**
 * POST /partners/designs/:designId/moodboard/generate
 *
 * Partner mirror of the admin generate route (#1113 S2). Builds the design's
 * moodboard scene from its structured data — including the **brief anchor
 * frames** (Concept & Identity · Audience & Positioning · Timeline & Budget) —
 * and persists it to `design.moodboard`.
 *
 * Differs from the admin route in two deliberate ways:
 *  1. Access = owner OR assigned partner (the invited designer holds an
 *     assignment link, not ownership).
 *  2. A brief-only design (no measurements/construction yet) can still generate
 *     — the tech-pack completeness gate only applies to the tech-pack frames, so
 *     a freshly-assembled brief renders its cards without a hard failure.
 *
 * Merges into any existing moodboard by frame name (mergeFramesIntoScene), so
 * regenerating refreshes the brief/tech-pack frames without clobbering the
 * designer's own additions — this is the "new moodboard inside one document".
 */
export const POST = async (
  req: AuthenticatedMedusaRequest & { params: { designId: string } },
  res: MedusaResponse
) => {
  const designId = req.params.designId
  await assertPartnerCanAuthorDesign(req, designId)

  // Shared build: brief anchor frames + Design Specs / Materials reference
  // frames + Contents index (workspace scaffold is seed-only, so a refresh here
  // never clobbers the designer's own work). Merge-not-clobber onto the board.
  const built = await buildDesignMoodboard(req.scope, designId, REFRESH_SCENE_OPTS)
  if (!built) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Nothing to generate yet. Add a brief (concept, audience, or timeline), a size set, or a construction spec."
    )
  }

  const { errors } = await updateDesignWorkflow(req.scope).run({
    input: { id: designId, moodboard: built.merged } as any,
  })
  if (errors.length > 0) {
    throw errors
  }

  res.json({ moodboard: built.merged })
}
