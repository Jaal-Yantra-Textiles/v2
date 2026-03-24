import { MedusaError } from "@medusajs/framework/utils"
import {
  StepResponse,
  WorkflowResponse,
  createStep,
  createWorkflow,
} from "@medusajs/framework/workflows-sdk"

import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import type ProductionRunService from "../../modules/production_runs/service"

// Timeout: 23 days (matching send-to-partner), capped at Node.js safe max
const NODE_MAX_TIMEOUT_MS = 2_147_483_647
const SAFE_MAX_TIMEOUT_SECONDS = Math.floor(NODE_MAX_TIMEOUT_MS / 1000)
const MAX_ALLOWED_SECONDS = 60 * 60 * 24 * 23
const envTimeout = Number(process.env.PRODUCTION_RUN_AWAIT_TIMEOUT_SECONDS)
const DEFAULT_TIMEOUT_SECONDS = MAX_ALLOWED_SECONDS
const desiredTimeout =
  Number.isFinite(envTimeout) && envTimeout > 0
    ? envTimeout
    : DEFAULT_TIMEOUT_SECONDS
export const LIFECYCLE_TIMEOUT_SECONDS = Math.min(
  desiredTimeout,
  MAX_ALLOWED_SECONDS,
  SAFE_MAX_TIMEOUT_SECONDS
)

export const lifecycleWorkflowId = "run-production-run-lifecycle"
export const awaitRunStartStepId = "await-run-start"
export const awaitRunFinishStepId = "await-run-finish"
export const awaitRunCompleteStepId = "await-run-complete"

export type RunProductionRunLifecycleInput = {
  production_run_id: string
}

const validateAndStampRunStep = createStep(
  "validate-and-stamp-run-for-lifecycle",
  async (input: { production_run_id: string }, { container, context }) => {
    const productionRunService: ProductionRunService =
      container.resolve(PRODUCTION_RUNS_MODULE)

    const run = await productionRunService.retrieveProductionRun(
      input.production_run_id
    )

    if (!run) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `ProductionRun ${input.production_run_id} not found`
      )
    }

    // Store the lifecycle workflow's transaction ID on the run
    // so partner endpoints can signal the correct workflow instance
    const existingMetadata = ((run as any).metadata || {}) as Record<string, any>
    await productionRunService.updateProductionRuns({
      id: run.id,
      metadata: {
        ...existingMetadata,
        lifecycle_transaction_id: context.transactionId,
      },
    })

    return new StepResponse(run)
  }
)

export const awaitRunStartStep = createStep(
  {
    name: awaitRunStartStepId,
    async: true,
    timeout: LIFECYCLE_TIMEOUT_SECONDS,
    maxRetries: 2,
  },
  async () => {}
)

export const awaitRunFinishStep = createStep(
  {
    name: awaitRunFinishStepId,
    async: true,
    timeout: LIFECYCLE_TIMEOUT_SECONDS,
    maxRetries: 2,
  },
  async () => {}
)

export const awaitRunCompleteStep = createStep(
  {
    name: awaitRunCompleteStepId,
    async: true,
    timeout: LIFECYCLE_TIMEOUT_SECONDS,
    maxRetries: 2,
  },
  async () => {}
)

const cascadeCompletionStep = createStep(
  "cascade-run-completion",
  async (input: { production_run_id: string }, { container }) => {
    const productionRunService: ProductionRunService =
      container.resolve(PRODUCTION_RUNS_MODULE)

    const run = await productionRunService.retrieveProductionRun(
      input.production_run_id
    )

    if (!run) {
      return new StepResponse(null)
    }

    const parentRunId = (run as any)?.parent_run_id
    if (!parentRunId) {
      return new StepResponse({ run })
    }

    const children = await productionRunService.listProductionRuns({
      parent_run_id: parentRunId,
    } as any)

    const allChildrenCompleted = (children || []).every(
      (c: any) => String(c?.status || "") === "completed"
    )

    if (allChildrenCompleted) {
      const parent = await productionRunService
        .retrieveProductionRun(parentRunId)
        .catch(() => null)

      if (
        parent &&
        !["completed", "cancelled"].includes(String((parent as any).status))
      ) {
        await productionRunService.updateProductionRuns({
          id: parentRunId,
          status: "completed" as any,
          completed_at: new Date(),
        })
      }
    }

    return new StepResponse({ run })
  }
)

export const runProductionRunLifecycleWorkflow = createWorkflow(
  {
    name: lifecycleWorkflowId,
    store: true,
  },
  (input: RunProductionRunLifecycleInput) => {
    const run = validateAndStampRunStep({
      production_run_id: input.production_run_id,
    })

    awaitRunStartStep()
    awaitRunFinishStep()
    awaitRunCompleteStep()

    cascadeCompletionStep({
      production_run_id: input.production_run_id,
    })

    return new WorkflowResponse({ run })
  }
)
