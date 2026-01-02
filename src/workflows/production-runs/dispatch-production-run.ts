import { MedusaError, Modules, TransactionHandlerType } from "@medusajs/framework/utils"
import {
  StepResponse,
  WorkflowResponse,
  createStep,
  createWorkflow,
  transform,
} from "@medusajs/framework/workflows-sdk"
import type { IWorkflowEngineService } from "@medusajs/framework/types"

import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import type ProductionRunService from "../../modules/production_runs/service"
import {
  sendProductionRunToProductionWorkflow,
} from "./send-production-run-to-production"

export const dispatchProductionRunWorkflowId = "dispatch-production-run"
export const waitDispatchTemplateSelectionStepId =
  "wait-dispatch-template-selection"

export type DispatchProductionRunInput = {
  production_run_id: string
}

type DispatchTemplateSelection = {
  template_names: string[]
}

const retrieveProductionRunForDispatchStep = createStep(
  "retrieve-production-run-for-dispatch",
  async (input: { production_run_id: string }, { container }) => {
    const productionRunService: ProductionRunService = container.resolve(
      PRODUCTION_RUNS_MODULE
    )

    const run = await productionRunService.retrieveProductionRun(input.production_run_id)

    if (!run) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `ProductionRun ${input.production_run_id} not found`
      )
    }

    if (!run.partner_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `ProductionRun ${run.id} must have partner_id to dispatch`
      )
    }

    if (String(run.status) !== "approved") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `ProductionRun ${run.id} must be approved before dispatch. Current status: ${run.status}`
      )
    }

    const dispatchState = (run.metadata as any)?.dispatch?.state
    if (dispatchState === "awaiting_templates") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `ProductionRun ${run.id} dispatch is already awaiting template selection`
      )
    }

    return new StepResponse(run)
  }
)

const markDispatchStartedStep = createStep(
  "mark-production-run-dispatch-started",
  async (input: { run: any }, { container }) => {
    const productionRunService: ProductionRunService = container.resolve(
      PRODUCTION_RUNS_MODULE
    )

    const run = input.run
    const existingMetadata = (run?.metadata || {}) as Record<string, any>
    const existingDispatch = (existingMetadata.dispatch || {}) as Record<string, any>

    const updated = await productionRunService.updateProductionRuns({
      id: run.id,
      metadata: {
        ...existingMetadata,
        dispatch: {
          ...existingDispatch,
          state: "awaiting_templates",
          started_at: new Date().toISOString(),
        },
      },
    })

    return new StepResponse(updated)
  }
)

export const waitDispatchTemplateSelectionStep = createStep(
  {
    name: waitDispatchTemplateSelectionStepId,
    async: true,
    timeout: 60 * 60 * 1,
  },
  async () => {}
)

const markDispatchCompletedStep = createStep(
  "mark-production-run-dispatch-completed",
  async (input: { run: any }, { container }) => {
    const productionRunService: ProductionRunService = container.resolve(
      PRODUCTION_RUNS_MODULE
    )

    const run = await productionRunService.retrieveProductionRun(input.run.id)
    const existingMetadata = (run?.metadata || {}) as Record<string, any>
    const existingDispatch = (existingMetadata.dispatch || {}) as Record<string, any>

    const updated = await productionRunService.updateProductionRuns({
      id: run.id,
      metadata: {
        ...existingMetadata,
        dispatch: {
          ...existingDispatch,
          state: "completed",
          completed_at: new Date().toISOString(),
        },
      },
    })

    return new StepResponse(updated)
  }
)

export const signalDispatchTemplateSelectionStep = createStep(
  "signal-dispatch-template-selection-step",
  async (
    input: {
      transaction_id: string
      template_names: string[]
    },
    { container }
  ) => {
    const engineService = container.resolve(
      Modules.WORKFLOW_ENGINE
    ) as IWorkflowEngineService

    await engineService.setStepSuccess({
      idempotencyKey: {
        action: TransactionHandlerType.INVOKE,
        transactionId: input.transaction_id,
        stepId: waitDispatchTemplateSelectionStepId,
        workflowId: dispatchProductionRunWorkflowId,
      },
      stepResponse: new StepResponse({ template_names: input.template_names }),
    })

    return new StepResponse(true)
  }
)

export const dispatchProductionRunWorkflow = createWorkflow(
  {
    name: dispatchProductionRunWorkflowId,
    store: true,
  },
  (input: DispatchProductionRunInput) => {
    const run = retrieveProductionRunForDispatchStep({
      production_run_id: input.production_run_id,
    })

    markDispatchStartedStep({ run })

    const selection = waitDispatchTemplateSelectionStep() as unknown as DispatchTemplateSelection

    sendProductionRunToProductionWorkflow.runAsStep({
      input: transform({ input, selection }, (data) => ({
        production_run_id: data.input.production_run_id,
        template_names: data.selection?.template_names || [],
      })),
    })

    markDispatchCompletedStep({ run })

    return new WorkflowResponse({ run })
  }
)
