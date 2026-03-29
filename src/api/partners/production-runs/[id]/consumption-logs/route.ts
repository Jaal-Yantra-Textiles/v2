import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"

import { PRODUCTION_RUNS_MODULE } from "../../../../../modules/production_runs"
import type ProductionRunService from "../../../../../modules/production_runs/service"
import { logConsumptionWorkflow } from "../../../../../workflows/consumption-logs/log-consumption"
import { listConsumptionLogsWorkflow } from "../../../../../workflows/consumption-logs/list-consumption-logs"
import type { PartnerPostProductionRunConsumptionLogReq } from "./validators"

export const POST = async (
  req: AuthenticatedMedusaRequest<PartnerPostProductionRunConsumptionLogReq>,
  res: MedusaResponse
) => {
  const partnerId = req.auth_context?.actor_id
  if (!partnerId) {
    return res.status(401).json({ error: "Partner authentication required" })
  }

  const id = req.params.id

  const productionRunService: ProductionRunService =
    req.scope.resolve(PRODUCTION_RUNS_MODULE)

  const run = await productionRunService
    .retrieveProductionRun(id)
    .catch(() => null)

  if (!run || (run as any).partner_id !== partnerId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Production run ${id} not found`
    )
  }

  if ((run as any).status !== "in_progress") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Consumption can only be logged when run is in_progress"
    )
  }

  const designId = (run as any).design_id
  if (!designId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Production run has no design linked"
    )
  }

  const { result, errors } = await logConsumptionWorkflow(req.scope).run({
    input: {
      design_id: designId,
      inventory_item_id: req.validatedBody.inventoryItemId,
      raw_material_id: req.validatedBody.rawMaterialId,
      quantity: req.validatedBody.quantity,
      unit_cost: req.validatedBody.unitCost,
      unit_of_measure: req.validatedBody.unitOfMeasure,
      consumption_type: req.validatedBody.consumptionType,
      consumed_by: "partner",
      notes: req.validatedBody.notes,
      location_id: req.validatedBody.locationId,
      metadata: {
        ...req.validatedBody.metadata,
        production_run_id: id,
      },
    },
  })

  if (errors?.length) {
    throw errors[0]?.error || new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Failed to log consumption"
    )
  }

  res.status(201).json({ consumption_log: result })
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partnerId = req.auth_context?.actor_id
  if (!partnerId) {
    return res.status(401).json({ error: "Partner authentication required" })
  }

  const id = req.params.id

  const productionRunService: ProductionRunService =
    req.scope.resolve(PRODUCTION_RUNS_MODULE)

  const run = await productionRunService
    .retrieveProductionRun(id)
    .catch(() => null)

  if (!run || (run as any).partner_id !== partnerId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Production run ${id} not found`
    )
  }

  const designId = (run as any).design_id
  if (!designId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Production run has no design linked"
    )
  }

  const query = req.query as Record<string, any>

  // Fetch all logs for this design (no pagination at workflow level)
  // then post-filter to this run. This avoids the pagination + post-filter
  // interaction bug where page boundaries could hide matching logs.
  const { result, errors } = await listConsumptionLogsWorkflow(req.scope).run({
    input: {
      design_id: designId,
      filters: {
        consumption_type: query.consumption_type,
        is_committed:
          query.is_committed !== undefined
            ? query.is_committed === "true"
            : undefined,
        consumed_by: query.consumed_by,
        inventory_item_id: query.inventory_item_id,
      },
      limit: 500,
      offset: 0,
    },
  })

  if (errors?.length) {
    throw errors[0]?.error || new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Failed to list consumption logs"
    )
  }

  // Scope to this production run — logs carry production_run_id in metadata
  const allLogs = (result as any)?.logs || []
  const scopedLogs = allLogs.filter(
    (log: any) => log.metadata?.production_run_id === id
  )

  // Apply pagination on the run-scoped result
  const limit = query.limit ? parseInt(query.limit, 10) : 50
  const offset = query.offset ? parseInt(query.offset, 10) : 0
  const paginatedLogs = scopedLogs.slice(offset, offset + limit)

  res.status(200).json({
    logs: paginatedLogs,
    count: scopedLogs.length,
    limit,
    offset,
  })
}
