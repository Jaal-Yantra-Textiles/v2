import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { seedDesignMoodboardIfEmpty } from "../../../../../../workflows/designs/moodboard/seed-design-moodboard"
import { assertPartnerCanAuthorDesign } from "../../../helpers"

/**
 * POST /partners/designs/:designId/moodboard/seed
 *
 * Partner mirror of the admin seed route (#1113). Idempotent, brief-friendly:
 * fills an empty `design.moodboard` from the brief so an invited designer opens
 * onto a populated, editable snapshot — never clobbers a board they've already
 * started. No-throw: nothing to render yet → `{ moodboard: null }`.
 *
 * Access = owner OR assigned partner (the invited designer holds an assignment
 * link, not ownership), same as the generate route.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest & { params: { designId: string } },
  res: MedusaResponse
) => {
  const designId = req.params.designId
  await assertPartnerCanAuthorDesign(req, designId)

  const moodboard = await seedDesignMoodboardIfEmpty(req.scope, designId)
  res.json({ moodboard })
}
