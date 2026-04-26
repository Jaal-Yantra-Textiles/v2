/**
 * @file Admin API route for confirming person import transactions
 * @description Provides an endpoint to confirm and initiate the actual import process for person data
 * @module API/Admin/Persons
 */

/**
 * @typedef {Object} ConfirmImportResponse
 * @property {boolean} success - Indicates whether the confirmation was successful
 */

/**
 * Confirm a person import transaction
 * @route POST /admin/persons/import/{transaction_id}/confirm
 * @group Person - Operations related to person management
 * @param {string} transaction_id.path.required - The unique identifier of the import transaction to confirm
 * @returns {ConfirmImportResponse} 200 - Success confirmation
 * @throws {MedusaError} 400 - Invalid transaction ID format
 * @throws {MedusaError} 401 - Unauthorized access
 * @throws {MedusaError} 404 - Transaction not found
 * @throws {MedusaError} 500 - Internal server error during confirmation
 *
 * @example request
 * POST /admin/persons/import/imp_123456789/confirm
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
import { importPersonsWorkflowId } from "../../../../../../workflows/persons/import-person/workflows/import-persons"
import { waitConfirmationPersonImportStepId } from "../../../../../../workflows/persons/import-person/steps/wait-confirmation-person-import"

/**
 * @swagger
 * /admin/persons/import/{transaction_id}/confirm:
 *   post:
 *     summary: Confirm person import
 *     description: Confirms a person import transaction, starting the actual import process.
 *     tags:
 *       - Person
 *     parameters:
 *       - in: path
 *         name: transaction_id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the transaction to confirm
 *     responses:
 *       200:
 *         description: OK
 */
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
      stepId: waitConfirmationPersonImportStepId,
      workflowId: importPersonsWorkflowId,
    },
    stepResponse: new StepResponse(true),
  })

  res.status(200).json({ success: true })
}
