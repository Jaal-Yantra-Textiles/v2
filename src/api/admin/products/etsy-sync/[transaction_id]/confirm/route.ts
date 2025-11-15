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
