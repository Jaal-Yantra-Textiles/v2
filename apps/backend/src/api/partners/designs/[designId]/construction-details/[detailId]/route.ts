import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { DESIGN_MODULE } from "../../../../../../modules/designs"
import type DesignService from "../../../../../../modules/designs/service"
import { assertPartnerCanAuthorDesign } from "../../../helpers"

/**
 * DELETE /partners/designs/:designId/construction-details/:detailId
 *
 * Remove a construction detail the designer added. Author-scoped; guarded so a
 * detail is only deletable when it belongs to this design and is a Construction
 * spec (never another design's or a non-construction spec).
 */
export const DELETE = async (
  req: AuthenticatedMedusaRequest & { params: { designId: string; detailId: string } },
  res: MedusaResponse
) => {
  const { designId, detailId } = req.params
  await assertPartnerCanAuthorDesign(req, designId)

  const designService = req.scope.resolve(DESIGN_MODULE) as DesignService
  const [spec] = await designService.listDesignSpecifications({
    id: detailId,
    design_id: designId,
    category: "Construction",
  })
  if (!spec) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Construction detail ${detailId} not found on this design`
    )
  }

  await designService.deleteDesignSpecifications(detailId)
  res.json({ id: detailId, deleted: true })
}
