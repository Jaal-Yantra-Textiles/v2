/**
 * @file Admin API route for retrieving production runs
 * @description Provides endpoints for retrieving detailed information about production runs including associated tasks
 * @module API/Admin/ProductionRuns
 */

/**
 * @typedef {Object} ProductionRun
 * @property {string} id - The unique identifier for the production run
 * @property {string} name - The name of the production run
 * @property {string} status - The current status of the production run (e.g., "pending", "in_progress", "completed")
 * @property {Date} created_at - When the production run was created
 * @property {Date} updated_at - When the production run was last updated
 * @property {string} [description] - Optional description of the production run
 * @property {string} [product_id] - The ID of the product being produced
 * @property {number} [quantity] - The quantity of items to be produced
 * @property {Date} [start_date] - The planned start date of the production run
 * @property {Date} [end_date] - The planned end date of the production run
 */

/**
 * @typedef {Object} ProductionTask
 * @property {string} id - The unique identifier for the task
 * @property {string} name - The name of the task
 * @property {string} status - The current status of the task (e.g., "pending", "in_progress", "completed")
 * @property {string} [description] - Optional description of the task
 * @property {string} [assigned_to] - The user or team assigned to the task
 * @property {Date} [due_date] - The due date for the task
 * @property {Date} created_at - When the task was created
 * @property {Date} updated_at - When the task was last updated
 */

/**
 * @typedef {Object} ProductionRunResponse
 * @property {ProductionRun} production_run - The production run details
 * @property {ProductionTask[]} tasks - Array of tasks associated with the production run
 */

/**
 * Retrieve a production run by ID
 * @route GET /admin/production-runs/{id}
 * @group ProductionRun - Operations related to production runs
 * @param {string} id.path.required - The ID of the production run to retrieve
 * @returns {ProductionRunResponse} 200 - Production run object with associated tasks
 * @throws {MedusaError} 400 - Invalid ID format
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Production run not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * GET /admin/production-runs/prod_run_123456789
 *
 * @example response 200
 * {
 *   "production_run": {
 *     "id": "prod_run_123456789",
 *     "name": "Summer Collection 2023",
 *     "status": "in_progress",
 *     "created_at": "2023-05-01T08:00:00Z",
 *     "updated_at": "2023-05-15T10:30:00Z",
 *     "description": "Production run for summer collection t-shirts",
 *     "product_id": "prod_987654321",
 *     "quantity": 5000,
 *     "start_date": "2023-05-10T00:00:00Z",
 *     "end_date": "2023-06-30T00:00:00Z"
 *   },
 *   "tasks": [
 *     {
 *       "id": "task_111111111",
 *       "name": "Fabric Cutting",
 *       "status": "completed",
 *       "description": "Cut fabric according to pattern specifications",
 *       "assigned_to": "team_cutting",
 *       "due_date": "2023-05-12T00:00:00Z",
 *       "created_at": "2023-05-02T09:00:00Z",
 *       "updated_at": "2023-05-12T18:00:00Z"
 *     },
 *     {
 *       "id": "task_222222222",
 *       "name": "Sewing",
 *       "status": "in_progress",
 *       "description": "Assemble t-shirts from cut fabric",
 *       "assigned_to": "team_sewing",
 *       "due_date": "2023-05-25T00:00:00Z",
 *       "created_at": "2023-05-02T09:00:00Z",
 *       "updated_at": "2023-05-15T10:00:00Z"
 *     }
 *   ]
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { PRODUCTION_RUNS_MODULE } from "../../../../modules/production_runs"
import type ProductionRunService from "../../../../modules/production_runs/service"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const id = req.params.id
  const productionRunService: ProductionRunService = req.scope.resolve(
    PRODUCTION_RUNS_MODULE
  )

  const run = await productionRunService.retrieveProductionRun(id)

  // Include tasks if link field exists
  let tasks: any[] = []
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "production_runs",
      fields: ["*", "tasks.*"],
      filters: { id },
    })
    const node = (data || [])[0]
    tasks = node?.tasks || []
  } catch {
    // ignore if link not yet synced
  }

  return res.status(200).json({ production_run: run, tasks })
}

/**
 * POST /admin/production-runs/:id
 * Update a production run. quantity/role/run_type are only allowed before the
 * run is accepted/started. Cost fields (partner_cost_estimate, cost_type) are
 * editable by admins any time except cancelled, since admins may need to
 * record/correct cost after the partner has already begun work.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const id = req.params.id
  const productionRunService: ProductionRunService = req.scope.resolve(PRODUCTION_RUNS_MODULE)

  const run = await productionRunService.retrieveProductionRun(id) as any

  if (run.status === "cancelled") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Cannot edit a cancelled production run"
    )
  }

  const body = req.body as Record<string, any>
  const update: Record<string, any> = {}

  const touchesStructural =
    body.quantity !== undefined ||
    body.role !== undefined ||
    body.run_type !== undefined

  if (touchesStructural) {
    if (run.accepted_at || run.started_at) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Cannot edit quantity, role, or run_type after the run has been accepted or started"
      )
    }
    if (run.status === "completed") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Cannot edit a completed production run"
      )
    }
    if (body.quantity !== undefined) update.quantity = Number(body.quantity)
    if (body.role !== undefined) update.role = body.role
    if (body.run_type !== undefined) update.run_type = body.run_type
  }

  if (body.partner_cost_estimate !== undefined) {
    update.partner_cost_estimate =
      body.partner_cost_estimate === null ? null : Number(body.partner_cost_estimate)
  }
  if (body.cost_type !== undefined) {
    if (body.cost_type !== "total" && body.cost_type !== "per_unit") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "cost_type must be 'total' or 'per_unit'"
      )
    }
    update.cost_type = body.cost_type
  }

  if (Object.keys(update).length === 0) {
    return res.json({ production_run: run, message: "No changes" })
  }

  await productionRunService.updateProductionRuns({ id, ...update })
  const updated = await productionRunService.retrieveProductionRun(id)

  res.json({ production_run: updated })
}
