/**
 * @file Partner API route for accepting production runs
 * @description Provides endpoints for partners to accept production runs in the JYT Commerce platform
 * @module API/Partners/ProductionRuns
 */

/**
 * @typedef {Object} AcceptProductionRunInput
 * @property {string} production_run_id - The ID of the production run to accept
 * @property {string} partner_id - The ID of the partner accepting the production run
 */

/**
 * @typedef {Object} AcceptProductionRunResponse
 * @property {Object} result - The result of the accept operation
 * @property {string} result.production_run_id - The ID of the accepted production run
 * @property {string} result.status - The new status of the production run
 * @property {Date} result.updated_at - When the production run was updated
 */

/**
 * Accept a production run
 * @route POST /partners/production-runs/:id/accept
 * @group ProductionRun - Operations related to production runs
 * @param {string} id.path.required - The ID of the production run to accept
 * @returns {AcceptProductionRunResponse} 200 - Successfully accepted production run
 * @throws {MedusaError} 401 - Unauthorized - Partner authentication required
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 404 - Production run not found
 * @throws {MedusaError} 500 - Failed to accept production run
 *
 * @example request
 * POST /partners/production-runs/prun_123456789/accept
 *
 * @example response 200
 * {
 *   "result": {
 *     "production_run_id": "prun_123456789",
 *     "status": "accepted",
 *     "updated_at": "2023-01-01T00:00:00Z"
 *   }
 * }
 *
 * @example response 401
 * {
 *   "error": "Partner authentication required - no actor ID"
 * }
 *
 * @example response 404
 * {
 *   "error": "Production run not found"
 * }
 *
 * @example response 500
 * {
 *   "error": "Failed to accept production run: Error details"
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import {
  acceptProductionRunWorkflow,
} from "../../../../../workflows/production-runs/accept-production-run"

export async function POST(
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

  const { result, errors } = await acceptProductionRunWorkflow(req.scope).run({
    input: {
      production_run_id: id,
      partner_id: partnerId,
    },
  })

  if (errors?.length) {
    throw (
      errors[0].error ||
      new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to accept production run: ${errors
          .map((e: any) => e?.error?.message || String(e))
          .join(", ")}`
      )
    )
  }

  return res.status(200).json({ result })
}
