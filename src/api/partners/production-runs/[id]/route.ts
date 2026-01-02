import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { PRODUCTION_RUNS_MODULE } from "../../../../modules/production_runs"
import type ProductionRunService from "../../../../modules/production_runs/service"

export async function GET(
  req: AuthenticatedMedusaRequest & { params: { id: string } },
  res: MedusaResponse
) {
  const partnerId = req.auth_context?.actor_id
  if (!partnerId) {
    return res
      .status(401)
      .json({ error: "Partner authentication required - no actor ID" })
  }

  const id = req.params.id
  const productionRunService: ProductionRunService = req.scope.resolve(
    PRODUCTION_RUNS_MODULE
  )

  let run: any
  try {
    run = await productionRunService.retrieveProductionRun(id)
  } catch {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `ProductionRun ${id} not found for this partner ${partnerId}`
    )
  }

  const persistedPartnerId = run?.partner_id ?? run?.partnerId ?? null
  if (!persistedPartnerId || persistedPartnerId !== partnerId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `ProductionRun ${id} not found for this partner ${partnerId}`
    )
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // NOTE: In some cases, filtering by `id` alone via query.graph can behave unexpectedly
  // (even though the run is present in the partner list query). We therefore use the
  // same query shape as the list endpoint (filter by partner_id) and select the run
  // in application code.
  const { data } = await query.graph({
    entity: "production_runs",
    fields: ["*", "tasks.*"],
    filters: { partner_id: partnerId },
    pagination: { skip: 0, take: 200 },
  })

  const node = (data || []).find((r: any) => r?.id === id) || run

  return res.status(200).json({
    production_run: node,
    tasks: node?.tasks || [],
  })
}
