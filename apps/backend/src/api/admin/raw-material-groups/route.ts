/**
 * API: /admin/raw-material-groups  (#817 S3)
 *
 * GET  — list raw-material groups (the "product" parents that tie per-color
 *        raw_materials together). Query: q, status, offset, limit.
 * POST — create a group.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { RAW_MATERIAL_MODULE } from "../../../modules/raw_material"
import {
  CreateRawMaterialGroup,
  ListRawMaterialGroupsQuery,
} from "./validators"

export const GET = async (
  req: MedusaRequest<unknown, ListRawMaterialGroupsQuery>,
  res: MedusaResponse
) => {
  const query = req.validatedQuery as unknown as ListRawMaterialGroupsQuery
  const service: any = req.scope.resolve(RAW_MATERIAL_MODULE)

  const filters: Record<string, unknown> = {}
  if (query.status) filters.status = query.status
  if (query.q) filters.name = { $ilike: `%${query.q}%` }

  const [groups, count] = await service.listAndCountRawMaterialGroups(filters, {
    skip: query.offset,
    take: query.limit,
    order: { created_at: "DESC" },
    relations: ["material_type"],
  })

  res.status(200).json({
    raw_material_groups: groups,
    count,
    offset: query.offset,
    limit: query.limit,
  })
}

export const POST = async (
  req: MedusaRequest<CreateRawMaterialGroup>,
  res: MedusaResponse
) => {
  const body = req.validatedBody
  const service: any = req.scope.resolve(RAW_MATERIAL_MODULE)

  const { material_type_id, ...rest } = body
  const group = await service.createRawMaterialGroups({
    ...rest,
    ...(material_type_id ? { material_type_id } : {}),
  })

  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  logger.debug(`[raw-material-groups] created group ${group.id}`)

  res.status(201).json({ raw_material_group: group })
}
