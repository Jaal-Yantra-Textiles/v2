/**
 * @file Partner API routes for production runs
 * @description Provides endpoints for retrieving production runs associated with a partner in the JYT Commerce platform
 * @module API/Partners/ProductionRuns
 */

/**
 * @typedef {Object} ListProductionRunsQuery
 * @property {number} [limit=20] - Number of production runs to return (default: 20)
 * @property {number} [offset=0] - Pagination offset (default: 0)
 * @property {string} [status] - Filter by production run status
 * @property {string} [role] - Filter by production run role
 */

/**
 * @typedef {Object} ProductionRunTask
 * @property {string} id - The unique identifier for the task
 * @property {string} name - The name of the task
 * @property {string} status - The status of the task
 * @property {Date} created_at - When the task was created
 * @property {Date} updated_at - When the task was last updated
 */

/**
 * @typedef {Object} ProductionRun
 * @property {string} id - The unique identifier for the production run
 * @property {string} partner_id - The ID of the partner associated with this run
 * @property {string} status - The status of the production run
 * @property {string} role - The role of the production run
 * @property {Date} created_at - When the production run was created
 * @property {Date} updated_at - When the production run was last updated
 * @property {ProductionRunTask[]} tasks - Array of tasks associated with this production run
 */

/**
 * @typedef {Object} ProductionRunsListResponse
 * @property {ProductionRun[]} production_runs - Array of production runs
 * @property {number} count - Total count of production runs matching the filters
 * @property {number} limit - The limit used for pagination
 * @property {number} offset - The offset used for pagination
 */

/**
 * List production runs for a partner
 * @route GET /partners/production-runs
 * @group Production Runs - Operations related to production runs
 * @param {number} [offset=0] - Pagination offset (default: 0)
 * @param {number} [limit=20] - Number of items to return (default: 20)
 * @param {string} [status] - Filter by production run status
 * @param {string} [role] - Filter by production run role
 * @returns {ProductionRunsListResponse} 200 - Paginated list of production runs
 * @throws {MedusaError} 401 - Unauthorized - Partner authentication required
 *
 * @example request
 * GET /partners/production-runs?offset=0&limit=10&status=active
 *
 * @example response 200
 * {
 *   "production_runs": [
 *     {
 *       "id": "prod_run_123456789",
 *       "partner_id": "partner_987654321",
 *       "status": "active",
 *       "role": "manufacturing",
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-02T12:00:00Z",
 *       "tasks": [
 *         {
 *           "id": "task_111111111",
 *           "name": "Cutting",
 *           "status": "completed",
 *           "created_at": "2023-01-01T01:00:00Z",
 *           "updated_at": "2023-01-01T02:00:00Z"
 *         }
 *       ]
 *     }
 *   ],
 *   "count": 50,
 *   "offset": 0,
 *   "limit": 10
 * }
 *
 * @example response 401
 * {
 *   "error": "Partner authentication required - no actor ID"
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import type { ListProductionRunsQuery } from "./validators"
import { listPartnerProductionRunsWorkflow } from "../../../workflows/production-runs/list-partner-production-runs"

export async function GET(
  req: AuthenticatedMedusaRequest<ListProductionRunsQuery>,
  res: MedusaResponse
) {
  const { limit = 20, offset = 0, status, role, run_type, design_id } =
    (req.validatedQuery || {}) as ListProductionRunsQuery

  const partnerId = req.auth_context?.actor_id
  if (!partnerId) {
    return res
      .status(401)
      .json({ error: "Partner authentication required - no actor ID" })
  }

  // The read lives in a workflow so the admin inspection mirror
  // (`GET /admin/partners/:id/production-runs`, #843) runs exactly this query
  // and field set rather than a second copy. This route contributes auth only.
  const { result } = await listPartnerProductionRunsWorkflow(req.scope).run({
    input: {
      partnerId,
      status,
      role,
      run_type,
      design_id,
      offset,
      limit,
      locale: req.locale,
    },
  })

  return res.status(200).json(result)
}
