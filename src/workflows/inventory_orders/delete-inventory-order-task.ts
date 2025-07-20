import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { MedusaError } from "@medusajs/utils"
import InventoryOrderTaskLink from "../../links/inventory-orders-tasks"
import { TASKS_MODULE } from "../../modules/tasks"
import TaskService from "../../modules/tasks/service"

type DeleteInventoryOrderTaskInput = {
  inventoryOrderId: string
  taskId: string
}

export const deleteInventoryOrderTaskStep = createStep(
  "delete-inventory-order-task",
  async (input: DeleteInventoryOrderTaskInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    
    // First verify the task exists and belongs to the inventory order
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

    // Delete the task using the task service
    const taskService = container.resolve(TASKS_MODULE)
    await taskService.softDeleteTasks(input.taskId)

    return new StepResponse({ id: input.taskId, deleted: true })
  },
  async (data, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE)
    if (!data){
      return
    }
    await taskService.restoreTasks(data.id)
  }
)

export const deleteInventoryOrderTaskWorkflow = createWorkflow(
  "delete-inventory-order-task",
  (input: DeleteInventoryOrderTaskInput) => {
    const result = deleteInventoryOrderTaskStep(input)
    return new WorkflowResponse(result)
  }
)
