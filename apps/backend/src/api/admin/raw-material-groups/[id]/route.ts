/**
 * API: /admin/raw-material-groups/:id  (#817 S3, #829)
 *
 * GET  — a group with its per-color raw_materials and each color's linked
 *        inventory_item (id/sku). Feeds the group-ordering UI.
 * POST — update the group's fields (name/status + global specs a group holds
 *        once: composition, specifications, unit, material type, cost, lead time,
 *        MOQ, default stock location). New colors inherit these fill-blank; use
 *        the Data Plumbing "backfill-group-globals-to-colors" job to propagate
 *        edits onto already-created colors.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { RAW_MATERIAL_MODULE } from "../../../../modules/raw_material"
import { refetchRawMaterialGroup } from "../helpers"
import type { UpdateRawMaterialGroup } from "../validators"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const raw_material_group = await refetchRawMaterialGroup(id, req.scope)
  res.status(200).json({ raw_material_group })
}

export const POST = async (
  req: MedusaRequest<UpdateRawMaterialGroup>,
  res: MedusaResponse
) => {
  const { id } = req.params
  const body = req.validatedBody
  const service: any = req.scope.resolve(RAW_MATERIAL_MODULE)

  const existing = await service.retrieveRawMaterialGroup(id).catch(() => null)
  if (!existing) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Raw material group with id "${id}" not found`
    )
  }

  const { material_type_id, material_type, ...rest } = body

  // Resolve a category NAME to an id (find-or-create), mirroring the raw-material
  // create flow, so the group edit form's category picker can select or add one.
  let resolvedMaterialTypeId = material_type_id
  if (resolvedMaterialTypeId === undefined && material_type) {
    const existing = await service.listMaterialTypes({ name: material_type })
    resolvedMaterialTypeId =
      existing?.[0]?.id ??
      (await service.createMaterialTypes({ name: material_type }))?.id
  }

  await service.updateRawMaterialGroups({
    id,
    ...rest,
    // Pass material_type_id through only when resolved (supports clearing via null).
    ...(resolvedMaterialTypeId !== undefined
      ? { material_type_id: resolvedMaterialTypeId }
      : {}),
  })

  const raw_material_group = await refetchRawMaterialGroup(id, req.scope)
  res.status(200).json({ raw_material_group })
}
