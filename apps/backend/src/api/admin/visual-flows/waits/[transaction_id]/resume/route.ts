import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { IWorkflowEngineService } from "@medusajs/types"
import { Modules, TransactionHandlerType } from "@medusajs/utils"
import { StepResponse } from "@medusajs/workflows-sdk"
import {
  flowWaitWorkflowId,
  waitForFlowResumeStepId,
} from "../../../../../../workflows/visual-flows/flow-wait"

/**
 * #459 P1 — resume a suspended long-running flow wait.
 *
 * POST /admin/visual-flows/waits/:transaction_id/resume
 * body: { step_id?, workflow_id?, payload? }
 *
 * Mirrors the persons/geocode-addresses confirm route: resolves the workflow
 * engine and calls setStepSuccess against the suspended async step, passing an
 * optional payload that becomes the wait step's output. Defaults target the
 * flowWaitWorkflow's wait step so callers only need the transaction id.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const workflowEngineService: IWorkflowEngineService = req.scope.resolve(
    Modules.WORKFLOW_ENGINE
  )
  const transactionId = req.params.transaction_id
  const body = (req.body || {}) as {
    step_id?: string
    workflow_id?: string
    payload?: unknown
  }

  await workflowEngineService.setStepSuccess({
    idempotencyKey: {
      action: TransactionHandlerType.INVOKE,
      transactionId,
      stepId: body.step_id || waitForFlowResumeStepId,
      workflowId: body.workflow_id || flowWaitWorkflowId,
    },
    stepResponse: new StepResponse(body.payload ?? true),
  })

  res.status(200).json({ success: true, transaction_id: transactionId })
}
