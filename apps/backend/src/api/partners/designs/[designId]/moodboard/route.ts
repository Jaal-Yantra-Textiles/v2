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
import updateDesignWorkflow from "../../../../../workflows/designs/update-design"
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
  await assertPartnerCanAuthorDesign(req, designId)

  const { moodboard } = req.validatedBody

  const { errors } = await updateDesignWorkflow(req.scope).run({
    input: { id: designId, moodboard } as any,
  })
  if (errors.length > 0) {
    throw errors
  }

  res.status(200).json({ moodboard })
}
