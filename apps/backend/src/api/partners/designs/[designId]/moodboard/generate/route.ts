import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { saveDesignMoodboardWorkflow } from "../../../../../../workflows/designs/moodboard/save-design-moodboard"
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
 * and persists it to the PARTNER'S OWN board.
 *
 * 🔴 It used to run `updateDesignWorkflow({ moodboard })` — the legacy column
 * (#2017). Two things followed, both silent:
 *
 *  1. `resolveBoards` ignores that column the moment ANY board row exists, so
 *     on every migrated design the generate landed where nothing reads. The
 *     partner saw the scene appear on the canvas, was told "Moodboard
 *     generated", and lost it on reload — the UI clears the dirty flag straight
 *     after, so Save was greyed out too.
 *  2. On an unmigrated design the column IS what the admin is shown, so a
 *     partner's generate replaced the admin's board.
 *
 * The admin route was moved to the per-owner save when the entity landed; this
 * one was missed. Same fix, partner owner.
 *
 * Differs from the admin route in two deliberate ways:
 *  1. Access = owner OR assigned partner (the invited designer holds an
 *     assignment link, not ownership).
 *  2. A brief-only design (no measurements/construction yet) can still generate
 *     — the tech-pack completeness gate only applies to the tech-pack frames, so
 *     a freshly-assembled brief renders its cards without a hard failure.
 *
 * Merges into the partner's existing board by frame name (mergeFramesIntoScene),
 * so regenerating refreshes the brief/tech-pack frames without clobbering the
 * designer's own additions — this is the "new moodboard inside one document".
 */
export const POST = async (
  req: AuthenticatedMedusaRequest & { params: { designId: string } },
  res: MedusaResponse
) => {
  const designId = req.params.designId
  const { partner } = await assertPartnerCanAuthorDesign(req, designId)
  const owner = { type: "partner" as const, partnerId: partner.id }

  // Shared build: brief anchor frames + Design Specs / Materials reference
  // frames + Contents index (workspace scaffold is seed-only, so a refresh here
  // never clobbers the designer's own work). Merge-not-clobber onto THEIR board.
  const built = await buildDesignMoodboard(
    req.scope,
    designId,
    REFRESH_SCENE_OPTS,
    owner
  )
  if (!built) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Nothing to generate yet. Add a brief (concept, audience, or timeline), a size set, or a construction spec."
    )
  }

  const { result, errors } = await saveDesignMoodboardWorkflow(req.scope).run({
    input: { designId, owner, scene: built.merged },
  })
  if (errors?.length > 0) {
    throw errors[0].error
  }

  const board = (result as any)?.moodboard
  res.json({ moodboard: board?.scene ?? built.merged, board })
}
