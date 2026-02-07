/**
 * @file Admin API route for resuming dispatch of production runs
 * @description Provides an endpoint to resume the dispatch workflow for a specific production run
 * @module API/Admin/ProductionRuns
 */

/**
 * @typedef {Object} AdminResumeDispatchProductionRunReq
 * @property {string} transaction_id.required - The transaction ID associated with the production run dispatch workflow
 * @property {string[]} template_names.required - Array of template names to be used for dispatch
 */

/**
 * @typedef {Object} ResumeDispatchResponse
 * @property {boolean} success - Indicates whether the operation was successful
 */

/**
 * Resume dispatch workflow for a production run
 * @route POST /admin/production-runs/:id/resume-dispatch
 * @group ProductionRun - Operations related to production runs
 * @param {string} id.path.required - The ID of the production run to resume dispatch for
 * @param {AdminResumeDispatchProductionRunReq} request.body.required - Dispatch resume data
 * @returns {ResumeDispatchResponse} 200 - Success response indicating the dispatch workflow was resumed
 * @throws {MedusaError} 400 - Invalid input data or missing required fields
 * @throws {MedusaError} 401 - Unauthorized access
 * @throws {MedusaError} 404 - Production run not found
 * @throws {MedusaError} 500 - Internal server error when processing the workflow
 *
 * @example request
 * POST /admin/production-runs/prod_run_123456789/resume-dispatch
 * {
 *   "transaction_id": "txn_987654321",
 *   "template_names": ["template_standard", "template_premium"]
 * }
 *
 * @example response 200
 * {
 *   "success": true
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { IWorkflowEngineService } from "@medusajs/framework/types"
import { Modules, TransactionHandlerType } from "@medusajs/framework/utils"
import { StepResponse } from "@medusajs/framework/workflows-sdk"

import {
  dispatchProductionRunWorkflowId,
  waitDispatchTemplateSelectionStepId,
} from "../../../../../workflows/production-runs/dispatch-production-run"
import type { AdminResumeDispatchProductionRunReq } from "../../validators"

export const POST = async (
  req: MedusaRequest<AdminResumeDispatchProductionRunReq>,
  res: MedusaResponse
) => {
  const body = (req as any).validatedBody || req.body

  const workflowEngineService: IWorkflowEngineService = req.scope.resolve(
    Modules.WORKFLOW_ENGINE
  )

  await workflowEngineService.setStepSuccess({
    idempotencyKey: {
      action: TransactionHandlerType.INVOKE,
      transactionId: body.transaction_id,
      stepId: waitDispatchTemplateSelectionStepId,
      workflowId: dispatchProductionRunWorkflowId,
    },
    stepResponse: new StepResponse({ template_names: body.template_names }),
  })

  return res.status(200).json({ success: true })
}
