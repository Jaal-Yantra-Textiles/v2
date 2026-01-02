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
