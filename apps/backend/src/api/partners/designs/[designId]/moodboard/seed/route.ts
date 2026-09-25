import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { seedDesignMoodboardIfEmpty } from "../../../../../../workflows/designs/moodboard/seed-design-moodboard"
import { assertPartnerCanAuthorDesign } from "../../../helpers"

/**
 * POST /partners/designs/:designId/moodboard/seed
 *
 * Partner mirror of the admin seed route (#1113). Idempotent, brief-friendly:
 * fills THIS PARTNER'S empty board from the brief so an invited designer opens
 * onto a populated, editable snapshot — never clobbers a board they've already
 * started. No-throw: nothing to render yet → `{ moodboard: null }`.
 *
 * 🔴 Seeds the PARTNER'S own board (#2017). It used to seed the core one: a
 * designer's first open minted OUR board out of the brief and still left them
 * without one of their own, so the very next thing they saw was a board they
 * could not edit. "May author this design" is not "owns the core board" — the
 * same distinction the save route makes.
 *
 * Access = owner OR assigned partner (the invited designer holds an assignment
 * link, not ownership), same as the generate route.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest & { params: { designId: string } },
  res: MedusaResponse
) => {
  const designId = req.params.designId
  const { partner } = await assertPartnerCanAuthorDesign(req, designId)

  const moodboard = await seedDesignMoodboardIfEmpty(req.scope, designId, {
    type: "partner",
    partnerId: partner.id,
  })
  res.json({ moodboard })
}
