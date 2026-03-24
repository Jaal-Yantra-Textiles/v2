import { Modules, TransactionHandlerType } from "@medusajs/framework/utils"
import {
  StepResponse,
  WorkflowResponse,
  createStep,
  createWorkflow,
} from "@medusajs/framework/workflows-sdk"
import type { IWorkflowEngineService } from "@medusajs/framework/types"

import { lifecycleWorkflowId } from "./run-production-run-lifecycle"

export type SignalLifecycleStepInput = {
  transaction_id: string
  step_id: string
}

const signalLifecycleStepSuccessStep = createStep(
  "signal-lifecycle-step-success",
  async (input: SignalLifecycleStepInput, { container }) => {
    const engineService = container.resolve(
      Modules.WORKFLOW_ENGINE
    ) as IWorkflowEngineService

    try {
      await engineService.setStepSuccess({
        idempotencyKey: {
          action: TransactionHandlerType.INVOKE,
          transactionId: input.transaction_id,
          stepId: input.step_id,
          workflowId: lifecycleWorkflowId,
        },
        stepResponse: new StepResponse(true),
      })
    } catch (e: any) {
      // Step may already be completed — safe to ignore
      if (!String(e?.message || "").includes("status is ok")) {
        throw e
      }
    }

    return new StepResponse(true)
  }
)

export const signalLifecycleStepSuccessWorkflow = createWorkflow(
  "signal-lifecycle-step-success",
  (input: SignalLifecycleStepInput) => {
    const result = signalLifecycleStepSuccessStep(input)
    return new WorkflowResponse(result)
  }
)
