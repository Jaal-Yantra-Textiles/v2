import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  when,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import TaskService from "../../modules/tasks/service"
import { TASKS_MODULE } from "../../modules/tasks"
import { Status } from "./create-task"
import { updateTaskStep } from "./update-task"

export type CompletePartnerSubtaskInput = {
  task_id: string
  subtask_id: string
}

type VerifiedContext = {
  subtask: any
  parent: any
}

const verifySubtaskStep = createStep(
  "complete-partner-subtask-verify",
  async (input: CompletePartnerSubtaskInput, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE)
    const parent = await taskService.retrieveTask(input.task_id)
    if (!parent) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Parent task not found")
    }
    if ((parent as any).status !== "accepted" && (parent as any).status !== "in_progress") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Parent task must be accepted before completing subtasks (current status: ${(parent as any).status})`
      )
    }
    const subtask = await taskService.retrieveTask(input.subtask_id, {
      relations: ["parent_task"],
    })
    if (!subtask) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Subtask not found")
    }
    if ((subtask as any).parent_task?.id !== input.task_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Subtask does not belong to this task"
      )
    }
    return new StepResponse<VerifiedContext>({ subtask, parent })
  }
)

const updateSubtaskStatusStep = createStep(
  "complete-partner-subtask-update",
  async (input: { subtask_id: string }, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE)
    const prior = await taskService.retrieveTask(input.subtask_id)
    const priorStatus = (prior as any)?.status
    const priorCompletedAt = (prior as any)?.completed_at ?? null

    const updated = await taskService.updateTasks({
      id: input.subtask_id,
      status: "completed",
      completed_at: new Date(),
    })

    return new StepResponse(updated, {
      subtask_id: input.subtask_id,
      priorStatus,
      priorCompletedAt,
    })
  },
  async (compensationInput, { container }) => {
    if (!compensationInput) return
    const taskService: TaskService = container.resolve(TASKS_MODULE)
    await taskService.updateTasks({
      id: compensationInput.subtask_id,
      status: compensationInput.priorStatus,
      completed_at: compensationInput.priorCompletedAt,
    })
  }
)

const evaluateParentCompletionStep = createStep(
  "complete-partner-subtask-check-parent",
  async (input: { task_id: string }, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE)
    const parent = await taskService.retrieveTask(input.task_id, {
      relations: ["subtasks"],
    })
    const allCompleted = Array.isArray((parent as any).subtasks)
      ? (parent as any).subtasks.every((s: any) => s?.status === "completed")
      : false
    const shouldComplete = allCompleted && (parent as any).status !== "completed"
    return new StepResponse({ parent_completed: shouldComplete })
  }
)

export const completePartnerSubtaskWorkflow = createWorkflow(
  {
    name: "complete-partner-subtask",
    store: true,
  },
  (input: CompletePartnerSubtaskInput) => {
    verifySubtaskStep(input)

    const updatedSubtask = updateSubtaskStatusStep({ subtask_id: input.subtask_id })

    const parentEval = evaluateParentCompletionStep({ task_id: input.task_id })

    when({ parentEval }, (data) => data.parentEval.parent_completed).then(() => {
      updateTaskStep({
        id: input.task_id,
        update: { status: Status.completed },
      })
    })

    return new WorkflowResponse({
      subtask: updatedSubtask,
      parent_completed: parentEval,
    })
  }
)
