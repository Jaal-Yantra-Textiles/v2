/**
 * @file Partner API route for saving a design's moodboard scene (#1113 S3).
 * @description Persists the Excalidraw scene the designer edits on the canvas.
 *
 * Guarded by `assertPartnerCanAuthorDesign` (owner OR invited/assigned
 * designer) — deliberately NOT the owner-only `assertPartnerOwnsDesign` used by
 * the kitchen-sink design PUT, because the whole point of the #1113 invite flow
 * is that a *stranger* the design was granted to (assigned, not owner) authors
 * the moodboard. Scoped to the single `moodboard` column, so an assigned
 * designer can never touch owner-only design fields through this seam.
 *
 * PUT /partners/designs/:designId/moodboard → save the scene, returns { moodboard }
 *
 * @module API/Partners/Designs/Moodboard
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { saveDesignMoodboardWorkflow } from "../../../../../workflows/designs/moodboard/save-design-moodboard"
import { assertPartnerCanAuthorDesign } from "../../helpers"
import { SavePartnerMoodboard } from "./validators"

/**
 * @route PUT /partners/designs/{designId}/moodboard
 * @returns {Object} 200 - { moodboard }
 * @throws {MedusaError} 401 - Partner authentication required
 * @throws {MedusaError} 404 - Design not found
 * @throws {MedusaError} 400 (NOT_ALLOWED) - Not the owner nor an assigned author
 */
export async function PUT(
  req: AuthenticatedMedusaRequest<SavePartnerMoodboard> & {
    params: { designId: string }
  },
  res: MedusaResponse
): Promise<void> {
  const { designId } = req.params
  const { partner } = await assertPartnerCanAuthorDesign(req, designId)

  const { moodboard } = req.validatedBody

  /**
   * 🔴 #2017 — writes THE PARTNER'S OWN BOARD, not `design.moodboard`.
   *
   * This used to run `updateDesignWorkflow({ moodboard })`, i.e. replace the
   * single column the admin also writes. Last write won, silently, with a 200,
   * and the other party's work was simply gone the next time they opened it.
   *
   * `assertPartnerCanAuthorDesign` still gates the DESIGN — owner or invited
   * designer, the #1113 flow. Which BOARD they get is a separate question,
   * answered here by their own partner id, so "may author this design" can no
   * longer quietly mean "may overwrite the admin's board".
   */
  const { result, errors } = await saveDesignMoodboardWorkflow(req.scope).run({
    input: {
      designId,
      owner: { type: "partner", partnerId: partner.id },
      scene: moodboard,
    },
  })
  if (errors?.length > 0) {
    throw errors[0].error
  }

  const board = (result as any)?.moodboard
  res.status(200).json({ moodboard: board?.scene ?? moodboard, board })
}
