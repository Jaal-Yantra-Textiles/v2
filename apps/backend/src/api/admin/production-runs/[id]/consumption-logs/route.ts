/**
 * @route /admin/production-runs/:id/consumption-logs
 * @scope admin
 *
 * Record and read what a production RUN actually consumed.
 *
 * Why this exists alongside the design-scoped route: every capture path was
 * design-scoped, and a product-only provenance run (#1112) has no design. The
 * partner run-scoped route refuses those outright — "Production run has no
 * design linked" — so material used on a run minted from a retail fulfillment
 * could not be recorded anywhere at all.
 *
 * 🔑 The anchor is read off the RUN, never taken from the caller. The run
 * already carries the nullable `design_id` / `product_id` pair and branches on
 * presence; this route does the same, so a log can always name what was being
 * made without a caller being able to point it at an unrelated design.
 *
 * Part of #938 Phase 2 (re-parent operational links from design to product),
 * done without assuming Phase 0: product is not yet a universal key.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"

import { logConsumptionWorkflow } from "../../../../../workflows/consumption-logs/log-consumption"
import { listConsumptionLogsWorkflow } from "../../../../../workflows/consumption-logs/list-consumption-logs"
import { PRODUCTION_RUNS_MODULE } from "../../../../../modules/production_runs"
import type ProductionRunService from "../../../../../modules/production_runs/service"
import { AdminPostRunConsumptionLogReq } from "./validators"

/**
 * The run's anchor, refusing the one shape that cannot be recorded.
 *
 * A run with neither a design nor a product is not a thing that exists on prod
 * today (all 122 runs carry at least one), but "does not exist today" is not a
 * constraint — so it is checked rather than assumed.
 */
const resolveRunAnchor = async (
  scope: MedusaRequest["scope"],
  runId: string
) => {
  const service: ProductionRunService = scope.resolve(PRODUCTION_RUNS_MODULE)
  const run = (await service.retrieveProductionRun(runId)) as any

  if (!run) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Production run ${runId} not found`
    )
  }

  if (!run.design_id && !run.product_id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Production run ${runId} names neither a design nor a product, so there is ` +
        `nothing to anchor a consumption log to.`
    )
  }

  return {
    design_id: run.design_id ?? null,
    product_id: run.product_id ?? null,
    variant_id: run.variant_id ?? null,
  }
}

export const POST = async (
  req: MedusaRequest<AdminPostRunConsumptionLogReq>,
  res: MedusaResponse
) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const runId = req.params.id

  const anchor = await resolveRunAnchor(req.scope, runId)

  const { result, errors } = await logConsumptionWorkflow(req.scope).run({
    input: {
      design_id: anchor.design_id,
      product_id: anchor.product_id,
      variant_id: anchor.variant_id,
      production_run_id: runId,
      inventory_item_id: req.validatedBody.inventoryItemId,
      raw_material_id: req.validatedBody.rawMaterialId,
      quantity: req.validatedBody.quantity,
      quantity_basis: req.validatedBody.quantityBasis ?? null,
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
    logger.warn(`Error reported at ${JSON.stringify(errors)}`)
    throw errors
  }

  res.status(201).json({ consumption_log: result })
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const runId = req.params.id
  const query = req.query as Record<string, any>

  const { result, errors } = await listConsumptionLogsWorkflow(req.scope).run({
    input: {
      production_run_id: runId,
      filters: {
        consumption_type: query.consumption_type,
        is_committed:
          query.is_committed !== undefined
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
    logger.warn(`Error reported at ${JSON.stringify(errors)}`)
    throw errors
  }

  res.status(200).json(result)
}
