import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { AdminPostConsumptionLogReq } from "./validators"
import { logConsumptionWorkflow } from "../../../../../workflows/consumption-logs/log-consumption"
import { listConsumptionLogsWorkflow } from "../../../../../workflows/consumption-logs/list-consumption-logs"

export const POST = async (
  req: MedusaRequest<AdminPostConsumptionLogReq>,
  res: MedusaResponse
) => {
  const designId = req.params.id

  const { result, errors } = await logConsumptionWorkflow(req.scope).run({
    input: {
      design_id: designId,
      production_run_id: req.validatedBody.productionRunId,
      inventory_item_id: req.validatedBody.inventoryItemId,
      raw_material_id: req.validatedBody.rawMaterialId,
      quantity: req.validatedBody.quantity,
      unit_cost: req.validatedBody.unitCost,
      unit_of_measure: req.validatedBody.unitOfMeasure,
      consumption_type: req.validatedBody.consumptionType,
      consumed_by: "admin",
      notes: req.validatedBody.notes,
      location_id: req.validatedBody.locationId,
      metadata: req.validatedBody.metadata,
    },
  })

  if (errors.length > 0) {
    console.warn("Error reported at", errors)
    throw errors
  }

  res.status(201).json({ consumption_log: result })
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const designId = req.params.id
  const query = req.query as Record<string, any>

  const { result, errors } = await listConsumptionLogsWorkflow(req.scope).run({
    input: {
      design_id: designId,
      filters: {
        consumption_type: query.consumption_type,
        is_committed: query.is_committed !== undefined
          ? query.is_committed === "true"
          : undefined,
        consumed_by: query.consumed_by,
        inventory_item_id: query.inventory_item_id,
      },
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    },
  })

  if (errors.length > 0) {
    console.warn("Error reported at", errors)
    throw errors
  }

  res.status(200).json(result)
}
