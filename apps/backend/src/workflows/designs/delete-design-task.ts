import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { TASKS_MODULE } from "../../modules/tasks"
import TaskService from "../../modules/tasks/service"
import designTasksLink from "../../links/design-tasks-link"
import { refetchEntity } from "@medusajs/framework"
import { DESIGN_MODULE } from "../../modules/designs"

type DeleteDesignTaskInput = {
  designId: string
  taskId: string
}

const validateTaskStep = createStep(
  "validate-task",
  async (input: DeleteDesignTaskInput, { container }) => {
    const query:any = container.resolve(ContainerRegistrationKeys.QUERY)

    const taskExists = await refetchEntity({
      entity: "task",
      idOrFilter: input.taskId,
      scope: container,
      fields: ["id"]
    })

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
        task_id: input.taskId
      }
    })

    return new StepResponse(tasks[0])
  }
)

const dismissLinkStep = createStep(
  "dismiss-link",
  async (input: DeleteDesignTaskInput, { container }) => {
    const link:any = container.resolve(ContainerRegistrationKeys.LINK)
    
    await link.dismiss({
      [DESIGN_MODULE]: {
        design_id: input.designId,
      },
      [TASKS_MODULE]: {
        task_id: input.taskId,
      },
    })

    return new StepResponse(true)
  }
)

const deleteTaskStep = createStep(
  "delete-task",
  async (input: DeleteDesignTaskInput, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE)
    await taskService.deleteTasks(input.taskId)
    return new StepResponse(true)
  }
)

export const deleteDesignTaskWorkflow = createWorkflow(
  "delete-design-task",
  (input: DeleteDesignTaskInput) => {
    const validateStep = validateTaskStep(input)
    const dismissStep = dismissLinkStep(input)
    const deleteStep = deleteTaskStep(input)
    return new WorkflowResponse([validateStep, dismissStep, deleteStep])
  }
)
