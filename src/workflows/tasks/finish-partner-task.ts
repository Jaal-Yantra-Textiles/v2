import {
  ContainerRegistrationKeys,
  Modules,
  TransactionHandlerType,
} from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import type { IWorkflowEngineService } from "@medusajs/types"
import TaskService from "../../modules/tasks/service"
import { TASKS_MODULE } from "../../modules/tasks"
import { Status } from "./create-task"
import { updateTaskStep } from "./update-task"
import { runTaskAssignmentWorkflow } from "./run-task-assignment"

export type FinishPartnerTaskInput = {
  task_id: string
  cost?: {
    actual_cost?: number
    cost_type?: "per_unit" | "total"
    cost_currency?: string
  }
}

// Marks all workflow_config.steps on the task metadata as "completed" and
// returns the prior metadata so the compensator can restore it on failure.
const markTaskStepsCompletedStep = createStep(
  "finish-partner-task-mark-steps-completed",
  async (input: { task_id: string }, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE)
    const prior = await taskService.retrieveTask(input.task_id)
    const priorMetadata = ((prior as any)?.metadata || {}) as Record<string, any>

    const workflowConfig = { ...(priorMetadata.workflow_config || {}) } as Record<string, any>
    const steps = Array.isArray(workflowConfig.steps) ? workflowConfig.steps : []

    if (!steps.length) {
      return new StepResponse({ skipped: true }, { task_id: input.task_id, priorMetadata })
    }

    const nextMetadata: Record<string, any> = {
      ...priorMetadata,
      workflow_config: {
        ...workflowConfig,
        steps: steps.map((s: any) => ({ ...s, status: "completed" })),
      },
    }

    await taskService.updateTasks({ id: input.task_id, metadata: nextMetadata })
    return new StepResponse({ skipped: false }, { task_id: input.task_id, priorMetadata })
  },
  async (compensationInput, { container }) => {
    if (!compensationInput) return
    const taskService: TaskService = container.resolve(TASKS_MODULE)
    await taskService.updateTasks({
      id: compensationInput.task_id,
      metadata: compensationInput.priorMetadata,
    })
  }
)

// Signals the run-task-assignment "await-task-finish" gate if the task has a
// transaction_id. Swallows all engine errors — it's expected to fail when the
// parent workflow has already completed or was cancelled.
const signalTaskFinishGateStep = createStep(
  "finish-partner-task-signal-gate",
  async (input: { updatedTasks: any[] }, { container }) => {
    const updatedTask = Array.isArray(input.updatedTasks) ? input.updatedTasks[0] : input.updatedTasks
    const txId = updatedTask?.transaction_id
    if (!txId) return new StepResponse({ signaled: false })

    const engineService = container.resolve(
      Modules.WORKFLOW_ENGINE
    ) as IWorkflowEngineService

    try {
      await engineService.setStepSuccess({
        idempotencyKey: {
          action: TransactionHandlerType.INVOKE,
          transactionId: txId,
          stepId: "await-task-finish",
          workflowId: runTaskAssignmentWorkflow.getName(),
        },
        stepResponse: new StepResponse(updatedTask, updatedTask.id),
      })
      return new StepResponse({ signaled: true })
    } catch {
      return new StepResponse({ signaled: false })
    }
  }
)

export const finishPartnerTaskWorkflow = createWorkflow(
  {
    name: "finish-partner-task",
    store: true,
  },
  (input: FinishPartnerTaskInput) => {
    markTaskStepsCompletedStep({ task_id: input.task_id })

    // `input` is a compose-time proxy; runtime conditional logic on its
    // properties (!= null, > 0, conditional spreads) must be wrapped in
    // transform() so it only evaluates when the step graph actually runs.
    const updateInput = transform({ input }, (data) => {
      const cost = data.input.cost || {}
      return {
        id: data.input.task_id,
        update: {
          status: Status.completed,
          ...(cost.actual_cost != null && cost.actual_cost > 0
            ? { actual_cost: cost.actual_cost }
            : {}),
          ...(cost.cost_type ? { cost_type: cost.cost_type } : {}),
          ...(cost.cost_currency ? { cost_currency: cost.cost_currency } : {}),
        },
      }
    })

    const updatedTasks = updateTaskStep(updateInput) as any

    signalTaskFinishGateStep({ updatedTasks })

    return new WorkflowResponse({ tasks: updatedTasks })
  }
)
