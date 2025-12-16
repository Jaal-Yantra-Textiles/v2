import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { MedusaError } from "@medusajs/utils"
import designTasksLink from "../../links/design-tasks-link"
import { refetchEntity } from "@medusajs/framework"

type GetDesignTaskInput = {
  designId: string
  taskId: string
  fields?: string[]
}

const getDesignTaskStep = createStep(
  "get-design-task",
  async (input: GetDesignTaskInput, { container }) => {
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
    
    const { data: task } = await query.graph({
      entity: designTasksLink.entryPoint,
      fields: input.fields || [
        "task.*"
      ],
      filters: {
        "task_id" : input.taskId,
      }
    })
    
   

    return new StepResponse(task[0]?.task)
  }
)

export const getDesignTaskWorkflow = createWorkflow(
  "get-design-task",
  (input: GetDesignTaskInput) => {
    const getTaskStep = getDesignTaskStep(input)
    return new WorkflowResponse([getTaskStep])
  }
)
