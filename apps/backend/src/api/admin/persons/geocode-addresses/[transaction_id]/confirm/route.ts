/**
 * @file Admin API route for confirming geocoded addresses
 * @description Provides an endpoint to confirm the successful geocoding of addresses in the JYT Commerce platform
 * @module API/Admin/Persons/GeocodeAddresses
 */

/**
 * @typedef {Object} ConfirmBody
 * @property {string} workflow_id - The ID of the workflow processing the geocoding
 * @property {string} step_id - The ID of the specific step in the workflow to confirm
 */

/**
 * Confirm successful geocoding of addresses
 * @route POST /admin/persons/geocode-addresses/{transaction_id}/confirm
 * @group GeocodeAddresses - Operations related to address geocoding
 * @param {string} transaction_id.path.required - The transaction ID for the geocoding operation
 * @param {ConfirmBody} request.body.required - Workflow and step identifiers
 * @returns {Object} 200 - Success confirmation
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Transaction not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * POST /admin/persons/geocode-addresses/geo_123456789/confirm
 * {
 *   "workflow_id": "wf_987654321",
 *   "step_id": "step_555666777"
 * }
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
import { IWorkflowEngineService } from "@medusajs/types"
import { Modules, TransactionHandlerType } from "@medusajs/utils"
import { StepResponse } from "@medusajs/workflows-sdk"
import { ConfirmBody } from "./validators"


export const POST = async (
  req: MedusaRequest<ConfirmBody>,
  res: MedusaResponse
) => {
  const workflowEngineService: IWorkflowEngineService = req.scope.resolve(
    Modules.WORKFLOW_ENGINE
  )
  const transactionId = req.params.transaction_id

  const { workflow_id: workflowId, step_id: stepId } = req.validatedBody

  await workflowEngineService.setStepSuccess({
    idempotencyKey: {
      action: TransactionHandlerType.INVOKE,
      transactionId,
      stepId,
      workflowId,
    },
    stepResponse: new StepResponse(true),
  })

  res.status(200).json({ success: true })
}
