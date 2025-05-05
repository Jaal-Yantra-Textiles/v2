import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
  createHook
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { TASKS_MODULE } from "../../modules/tasks"
import designTasksLink from "../../links/design-tasks-link"
import TaskService from "../../modules/tasks/service"
import { refetchEntity } from "@medusajs/framework"


enum Status {
  pending = "pending",
  in_progress = "in_progress",
  completed = "completed",
  cancelled = "cancelled",
  accepted = "accepted",
}

enum PriorityLevel {
  low = "low",
  medium = "medium",
  high = "high",
}

type UpdateDesignTaskInput = {
  designId: string
  taskId: string
  update: {
    title?: string
    description?: string
    status?: Status
    priority?: PriorityLevel
    start_date?: Date 
    end_date?: Date 
    eventable?: boolean
    notifiable?: boolean
    metadata?: Record<string, any>
  }
}

const validateTaskStep = createStep(
  "validate-task",
  async (input: UpdateDesignTaskInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const taskExists = await refetchEntity(
      "task",
      input.taskId,
      container,
      ["id"]
    )

    if (!taskExists) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Task with id ${input.taskId} not found in design ${input.designId}`
      )
    }

    const { data: tasks } = await query.graph({
      entity: designTasksLink.entryPoint,
      fields: ["task.*"],
      filters: {
        "task_id" : input.taskId,
      }
    })
    
    return new StepResponse(tasks[0])
  }
)

const updateTaskStep = createStep(
  "update-task",
  async (input: UpdateDesignTaskInput, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE)
    const task = await taskService.updateTasks({
      selector: {
        id: input.taskId
      },
      data :{
        ...input.update
      }
    })
    return new StepResponse(task)
  }
)

export const updateDesignTaskWorkflow = createWorkflow(
  "update-design-task",
  (input: UpdateDesignTaskInput) => {
    const validateStep = validateTaskStep(input)
    const updateStep = updateTaskStep(input)
    const designTaskUpdated = createHook(
      "designTaskUpdated", 
      { 
        taskID: input.taskId, 
        designId: input.designId,
        update: updateStep
      }
    )
    return new WorkflowResponse(updateStep, {
      hooks: [designTaskUpdated]
    })
  }
)
