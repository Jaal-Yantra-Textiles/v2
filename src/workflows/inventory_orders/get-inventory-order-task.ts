import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { MedusaError } from "@medusajs/utils"
import InventoryOrderTaskLink from "../../links/inventory-orders-tasks"

type GetInventoryOrderTaskInput = {
  inventoryOrderId: string
  taskId: string
  fields?: string[]
}

export const getInventoryOrderTaskStep = createStep(
  "get-inventory-order-task",
  async (input: GetInventoryOrderTaskInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    
    const { data } = await query.graph({
      entity: InventoryOrderTaskLink.entryPoint,
      fields: ["*", "inventory_orders.*", "task.*"],
      filters: {
        inventory_orders_id: input.inventoryOrderId,
        task_id: input.taskId
      }
    })

    if (!data || data.length === 0) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Task with id ${input.taskId} not found for inventory order ${input.inventoryOrderId}`
      )
    }

    return new StepResponse(data[0].task, data[0].task)
  }
)

export const getInventoryOrderTaskWorkflow = createWorkflow(
  "get-inventory-order-task",
  (input: GetInventoryOrderTaskInput) => {
    const task = getInventoryOrderTaskStep(input)
    
    return new WorkflowResponse(task)
  }
)
