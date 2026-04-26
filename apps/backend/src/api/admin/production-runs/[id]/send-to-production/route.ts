/**
 * @file Admin API route for sending production runs to production
 * @description Provides an endpoint to trigger the production workflow for a specific production run
 * @module API/Admin/ProductionRuns
 */

/**
 * @typedef {Object} AdminSendProductionRunToProductionReq
 * @property {string[]} template_names - Array of template names to be used in the production process
 */

/**
 * @typedef {Object} SendToProductionResult
 * @property {string} id - The unique identifier of the production run
 * @property {string} status - The updated status of the production run
 * @property {string[]} template_names - The template names used in production
 * @property {Date} sent_at - When the production run was sent to production
 * @property {Object} workflow_result - The result of the production workflow execution
 */

/**
 * Send a production run to production
 * @route POST /admin/production-runs/:id/send-to-production
 * @group ProductionRun - Operations related to production runs
 * @param {string} id.path.required - The ID of the production run to send to production
 * @param {AdminSendProductionRunToProductionReq} request.body.required - Production run data including template names
 * @returns {Object} 200 - Success response with production run details
 * @throws {MedusaError} 400 - Invalid input data or missing required fields
 * @throws {MedusaError} 401 - Unauthorized access
 * @throws {MedusaError} 404 - Production run not found
 * @throws {MedusaError} 500 - Internal server error during workflow execution
 *
 * @example request
 * POST /admin/production-runs/prod_run_123456789/send-to-production
 * {
 *   "template_names": ["template_standard", "template_premium"]
 * }
 *
 * @example response 200
 * {
 *   "result": {
 *     "id": "prod_run_123456789",
 *     "status": "in_production",
 *     "template_names": ["template_standard", "template_premium"],
 *     "sent_at": "2023-11-15T14:30:00Z",
 *     "workflow_result": {
 *       "success": true,
 *       "message": "Production run successfully sent to production",
 *       "details": {
 *         "templates_processed": 2,
 *         "estimated_completion": "2023-11-20T00:00:00Z"
 *       }
 *     }
 *   }
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { sendProductionRunToProductionWorkflow } from "../../../../../workflows/production-runs/send-production-run-to-production"
import type { AdminSendProductionRunToProductionReq } from "../../validators"

export const POST = async (
  req: MedusaRequest<AdminSendProductionRunToProductionReq>,
  res: MedusaResponse
) => {
  const id = req.params.id
  const body = (req as any).validatedBody || req.body

  const { result } = await sendProductionRunToProductionWorkflow(req.scope).run({
    input: {
      production_run_id: id,
      template_names: body.template_names,
    },
  })

  return res.status(200).json({ result })
}
