/**
 * API: /admin/raw-material-groups/:id/colors/link  (#817)
 *
 * POST — attach existing raw_materials to the group as colors by setting their
 *        group_id. No new inventory items are created (they keep whatever stock
 *        item they already have).
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { RAW_MATERIAL_MODULE } from "../../../../../../modules/raw_material"
import { LinkGroupColors } from "../../../validators"
import { refetchRawMaterialGroup } from "../../../helpers"

export const POST = async (
  req: MedusaRequest<LinkGroupColors>,
  res: MedusaResponse
) => {
  const { id: groupId } = req.params
  const { raw_material_ids } = req.validatedBody
  const service: any = req.scope.resolve(RAW_MATERIAL_MODULE)

  const group = await service.retrieveRawMaterialGroup(groupId).catch(() => null)
  if (!group) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Raw material group with id "${groupId}" not found`
    )
  }

  await service.updateRawMaterials(
    raw_material_ids.map((id: string) => ({ id, group_id: groupId }))
  )

  const raw_material_group = await refetchRawMaterialGroup(groupId, req.scope)
  res.status(200).json({ raw_material_group })
}
