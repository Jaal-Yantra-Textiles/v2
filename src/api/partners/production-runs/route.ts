import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import type { ListProductionRunsQuery } from "./validators"

export async function GET(
  req: AuthenticatedMedusaRequest<ListProductionRunsQuery>,
  res: MedusaResponse
) {
  const { limit = 20, offset = 0, status, role } = req.validatedQuery || {}

  const partnerId = req.auth_context?.actor_id
  if (!partnerId) {
    return res
      .status(401)
      .json({ error: "Partner authentication required - no actor ID" })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const filters: any = { partner_id: partnerId }
  if (status) {
    filters.status = status
  }
  if (role) {
    filters.role = role
  }

  const { data: runs, metadata } = await query.graph({
    entity: "production_runs",
    fields: ["*", "tasks.*"],
    filters,
    pagination: { skip: offset, take: limit },
  })

  const list = runs || []

  return res.status(200).json({
    production_runs: list,
    count: (metadata as any)?.count ?? list.length,
    limit,
    offset,
  })
}
