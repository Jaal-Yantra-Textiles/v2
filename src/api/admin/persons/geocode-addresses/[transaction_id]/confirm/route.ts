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
