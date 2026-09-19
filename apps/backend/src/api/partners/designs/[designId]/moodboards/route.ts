/**
 * @file GET /partners/designs/:designId/moodboards — the design's boards, from
 * this partner's point of view (#2017).
 *
 * `own` is theirs and editable; `others` are everyone else's, read-only. That
 * split is the entity's whole purpose, so it is computed once in
 * `resolveBoards` and shared with the admin route rather than re-derived per
 * surface.
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { resolveBoards } from "../../../../../modules/designs/lib/moodboard-ownership"
import { assertPartnerCanAuthorDesign } from "../../helpers"

export async function GET(
  req: AuthenticatedMedusaRequest & { params: { designId: string } },
  res: MedusaResponse
): Promise<void> {
  const { designId } = req.params
  const { partner } = await assertPartnerCanAuthorDesign(req, designId)

  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "designs",
    filters: { id: designId },
    fields: [
      "id",
      // The legacy blob, read so an unmigrated design does not present as
      // empty — see `resolveBoards`.
      "moodboard",
      "moodboards.id",
      "moodboards.owner_type",
      "moodboards.partner_id",
      "moodboards.title",
      "moodboards.scene",
      "moodboards.thumbnail_url",
      "moodboards.updated_at",
    ],
  })

  const design = data?.[0]
  const resolved = resolveBoards(design?.moodboards, design?.moodboard, {
    type: "partner",
    partnerId: partner.id,
  })

  res.status(200).json(resolved)
}
