import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

type GetDesignTasksInput = {
  designId: string
  fields?: string[]
}

const getDesignTasksStep = createStep(
  "get-design-tasks",
  async (input: GetDesignTasksInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    
    const { data: tasks } = await query.graph({
      entity: "design",
      fields: input.fields || [
        "tasks.*"
      ],
      filters: {
        id: input.designId
      }
        
    })
    return new StepResponse(tasks)
  }
)

export const getDesignTasksWorkflow = createWorkflow(
  "get-design-tasks",
  (input: GetDesignTasksInput) => {
    const getTasksStep = getDesignTasksStep(input)
    return new WorkflowResponse(getTasksStep)
  }
)
