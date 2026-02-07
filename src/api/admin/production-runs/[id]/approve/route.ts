/**
 * @file Admin API route for approving production runs
 * @description Provides an endpoint for approving production runs in the JYT Commerce platform
 * @module API/Admin/ProductionRuns
 */

/**
 * @typedef {Object} Assignment
 * @property {string} user_id - The ID of the user assigned to the production run
 * @property {string} role - The role of the user in the production run (e.g., "manager", "operator")
 */

/**
 * @typedef {Object} AdminApproveProductionRunReq
 * @property {Assignment[]} assignments - List of user assignments for the production run
 */

/**
 * @typedef {Object} ApproveProductionRunResult
 * @property {string} id - The unique identifier of the production run
 * @property {string} status - The status of the production run (e.g., "approved")
 * @property {string[]} assigned_users - List of user IDs assigned to the production run
 * @property {Date} approved_at - When the production run was approved
 */

/**
 * Approve a production run
 * @route POST /admin/production-runs/:id/approve
 * @group ProductionRun - Operations related to production runs
 * @param {string} id.path.required - The ID of the production run to approve
 * @param {AdminApproveProductionRunReq} request.body.required - Production run approval data
 * @returns {Object} 200 - Approval result
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Production run not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * POST /admin/production-runs/prod_run_123456789/approve
 * {
 *   "assignments": [
 *     {
 *       "user_id": "user_123456789",
 *       "role": "manager"
 *     },
 *     {
 *       "user_id": "user_987654321",
 *       "role": "operator"
 *     }
 *   ]
 * }
 *
 * @example response 200
 * {
 *   "result": {
 *     "id": "prod_run_123456789",
 *     "status": "approved",
 *     "assigned_users": ["user_123456789", "user_987654321"],
 *     "approved_at": "2023-01-01T00:00:00Z"
 *   }
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { approveProductionRunWorkflow } from "../../../../../workflows/production-runs/approve-production-run"
import type { AdminApproveProductionRunReq } from "../../validators"

export const POST = async (
  req: MedusaRequest<AdminApproveProductionRunReq>,
  res: MedusaResponse
) => {
  const id = req.params.id
  const body = (req as any).validatedBody || req.body

  const { result } = await approveProductionRunWorkflow(req.scope).run({
    input: {
      production_run_id: id,
      assignments: body.assignments,
    },
  })

  return res.status(200).json({ result })
}
