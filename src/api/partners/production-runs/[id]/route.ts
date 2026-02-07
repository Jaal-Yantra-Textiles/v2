/**
 * @file Partner API route for retrieving a specific production run
 * @description Provides an endpoint for partners to retrieve detailed information about a specific production run including its associated tasks
 * @module API/Partners/ProductionRuns
 */

/**
 * @typedef {Object} ProductionRunTask
 * @property {string} id - The unique identifier for the task
 * @property {string} name - The name of the task
 * @property {string} status - The current status of the task (e.g., "pending", "in_progress", "completed")
 * @property {Date} created_at - When the task was created
 * @property {Date} updated_at - When the task was last updated
 * @property {string} production_run_id - The ID of the associated production run
 */

/**
 * @typedef {Object} ProductionRunResponse
 * @property {string} id - The unique identifier for the production run
 * @property {string} name - The name of the production run
 * @property {string} status - The current status of the production run
 * @property {string} partner_id - The ID of the partner who owns this production run
 * @property {Date} created_at - When the production run was created
 * @property {Date} updated_at - When the production run was last updated
 * @property {Date} scheduled_at - When the production run is scheduled to occur
 * @property {Date} completed_at - When the production run was completed (null if not completed)
 * @property {string} notes - Additional notes about the production run
 * @property {ProductionRunTask[]} tasks - Array of tasks associated with this production run
 */

/**
 * Retrieve a specific production run by ID
 * @route GET /partners/production-runs/{id}
 * @group ProductionRun - Operations related to production runs
 * @param {string} id.path.required - The ID of the production run to retrieve
 * @returns {Object} 200 - The production run object with associated tasks
 * @throws {MedusaError} 401 - Partner authentication required - no actor ID
 * @throws {MedusaError} 404 - ProductionRun not found for this partner
 *
 * @example request
 * GET /partners/production-runs/prun_123456789
 *
 * @example response 200
 * {
 *   "production_run": {
 *     "id": "prun_123456789",
 *     "name": "Summer Collection 2023",
 *     "status": "in_progress",
 *     "partner_id": "partner_987654321",
 *     "created_at": "2023-05-01T08:00:00Z",
 *     "updated_at": "2023-05-15T10:30:00Z",
 *     "scheduled_at": "2023-06-01T00:00:00Z",
 *     "completed_at": null,
 *     "notes": "Initial production run for summer collection",
 *     "tasks": [
 *       {
 *         "id": "task_111111111",
 *         "name": "Fabric Cutting",
 *         "status": "completed",
 *         "created_at": "2023-05-02T09:00:00Z",
 *         "updated_at": "2023-05-05T17:00:00Z",
 *         "production_run_id": "prun_123456789"
 *       },
 *       {
 *         "id": "task_222222222",
 *         "name": "Sewing",
 *         "status": "in_progress",
 *         "created_at": "2023-05-06T08:00:00Z",
 *         "updated_at": "2023-05-15T10:30:00Z",
 *         "production_run_id": "prun_123456789"
 *       }
 *     ]
 *   },
 *   "tasks": [
 *     {
 *       "id": "task_111111111",
 *       "name": "Fabric Cutting",
 *       "status": "completed",
 *       "created_at": "2023-05-02T09:00:00Z",
 *       "updated_at": "2023-05-05T17:00:00Z",
 *       "production_run_id": "prun_123456789"
 *     },
 *     {
 *       "id": "task_222222222",
 *       "name": "Sewing",
 *       "status": "in_progress",
 *       "created_at": "2023-05-06T08:00:00Z",
 *       "updated_at": "2023-05-15T10:30:00Z",
 *       "production_run_id": "prun_123456789"
 *     }
 *   ]
 * }
 *
 * @example response 401
 * {
 *   "error": "Partner authentication required - no actor ID"
 * }
 *
 * @example response 404
 * {
 *   "error": "ProductionRun prun_123456789 not found for this partner partner_987654321"
 * }
 */
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
