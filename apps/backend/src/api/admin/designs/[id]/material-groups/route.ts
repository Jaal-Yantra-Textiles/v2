/**
 * API: /admin/designs/:id/material-groups  (#817 S4)
 *
 * GET  — list the raw_material_groups pinned to a design (with the resolved
 *        color, if any, and the group's colors).
 * POST — pin a group to the design.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import type { Link } from "@medusajs/modules-sdk"
import { DESIGN_MODULE } from "../../../../../modules/designs"
import { RAW_MATERIAL_MODULE } from "../../../../../modules/raw_material"
import DesignRawMaterialGroupLink from "../../../../../links/design-raw-material-group"
import { PinDesignGroup } from "./validators"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const designId = req.params.id
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: DesignRawMaterialGroupLink.entryPoint,
    fields: [
      "resolved_raw_material_id",
      "note",
      "metadata",
      "raw_material_group.id",
      "raw_material_group.name",
      "raw_material_group.composition",
      "raw_material_group.status",
      "raw_material_group.raw_materials.id",
      "raw_material_group.raw_materials.name",
      "raw_material_group.raw_materials.color",
    ],
    filters: { design_id: designId },
  })

  res.status(200).json({
    material_groups: data ?? [],
    count: (data ?? []).length,
  })
}

export const POST = async (
  req: MedusaRequest<PinDesignGroup>,
  res: MedusaResponse
) => {
  const designId = req.params.id
  const body = req.validatedBody
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as Link

  // The group must exist.
  const service: any = req.scope.resolve(RAW_MATERIAL_MODULE)
  const group = await service
    .retrieveRawMaterialGroup(body.raw_material_group_id)
    .catch(() => null)
  if (!group) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Raw material group with id "${body.raw_material_group_id}" not found`
    )
  }

  await remoteLink.create({
    [DESIGN_MODULE]: { design_id: designId },
    [RAW_MATERIAL_MODULE]: { raw_material_group_id: body.raw_material_group_id },
    data: {
      resolved_raw_material_id: body.resolved_raw_material_id ?? null,
      note: body.note ?? null,
      metadata: body.metadata ?? null,
    },
  })

  res.status(201).json({ design_id: designId, raw_material_group: group })
}
