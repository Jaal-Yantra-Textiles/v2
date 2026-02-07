/**
 * @file Admin API route for confirming Etsy product sync transactions
 * @description Provides an endpoint to confirm successful Etsy product synchronization workflow steps
 * @module API/Admin/EtsySync
 */

/**
 * @typedef {Object} EtsySyncConfirmationResponse
 * @property {boolean} success - Indicates whether the confirmation was successful
 */

/**
 * Confirm successful Etsy product sync transaction
 * @route POST /admin/products/etsy-sync/:transaction_id/confirm
 * @group EtsySync - Operations related to Etsy product synchronization
 * @param {string} transaction_id.path.required - The unique transaction ID of the Etsy sync workflow
 * @returns {EtsySyncConfirmationResponse} 200 - Confirmation success response
 * @throws {MedusaError} 400 - Invalid transaction ID format
 * @throws {MedusaError} 401 - Unauthorized access
 * @throws {MedusaError} 404 - Transaction not found
 * @throws {MedusaError} 500 - Workflow engine error
 *
 * @example request
 * POST /admin/products/etsy-sync/trans_123456789/confirm
 *
 * @example response 200
 * {
 *   "success": true
 * }
 */
import {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { IWorkflowEngineService } from "@medusajs/framework/types"
import { Modules, TransactionHandlerType } from "@medusajs/framework/utils"
import { StepResponse } from "@medusajs/framework/workflows-sdk"
import { 
  syncProductsToEtsyWorkflowId,
  waitConfirmationEtsySyncStepId 
} from "../../../../../../workflows/etsy_sync"

export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const workflowEngineService: IWorkflowEngineService = req.scope.resolve(
    Modules.WORKFLOW_ENGINE
  )

  const transactionId = req.params.transaction_id

  await workflowEngineService.setStepSuccess({
    idempotencyKey: {
      action: TransactionHandlerType.INVOKE,
      transactionId,
      stepId: waitConfirmationEtsySyncStepId,
      workflowId: syncProductsToEtsyWorkflowId,
    },
    stepResponse: new StepResponse(true),
  })

  res.status(200).json({ success: true })
}
