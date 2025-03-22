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
