/**
 * API: /admin/designs/:id/material-groups/:groupId  (#817 S4)
 *
 * POST   — update the pin (e.g. resolve the color at production time).
 * DELETE — unpin the group from the design.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { Link } from "@medusajs/modules-sdk"
import { DESIGN_MODULE } from "../../../../../../modules/designs"
import { RAW_MATERIAL_MODULE } from "../../../../../../modules/raw_material"
import { UpdateDesignGroup } from "../validators"

export const POST = async (
  req: MedusaRequest<UpdateDesignGroup>,
  res: MedusaResponse
) => {
  const { id: designId, groupId } = req.params
  const body = req.validatedBody
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as Link

  // Re-creating the link with the same keys updates its pivot data in place.
  const data: Record<string, unknown> = {}
  if (body.resolved_raw_material_id !== undefined) {
    data.resolved_raw_material_id = body.resolved_raw_material_id
  }
  if (body.note !== undefined) data.note = body.note
  if (body.metadata !== undefined) data.metadata = body.metadata

  await remoteLink.create({
    [DESIGN_MODULE]: { design_id: designId },
    [RAW_MATERIAL_MODULE]: { raw_material_group_id: groupId },
    data,
  })

  res.status(200).json({ design_id: designId, raw_material_group_id: groupId, updated: true })
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: designId, groupId } = req.params
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as Link

  await remoteLink.dismiss({
    [DESIGN_MODULE]: { design_id: designId },
    [RAW_MATERIAL_MODULE]: { raw_material_group_id: groupId },
  })

  res.status(200).json({ design_id: designId, raw_material_group_id: groupId, unpinned: true })
}
