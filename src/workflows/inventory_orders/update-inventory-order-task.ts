import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { MedusaError } from "@medusajs/utils"
import type { RemoteQueryFunction } from "@medusajs/types"
import InventoryOrderTaskLink from "../../links/inventory-orders-tasks"
import { TASKS_MODULE } from "../../modules/tasks"
import TaskService from "../../modules/tasks/service"

type UpdateInventoryOrderTaskInput = {
  inventoryOrderId: string
  taskId: string
  title?: string
  description?: string
  status?: string
  priority?: string
  due_date?: Date
  metadata?: Record<string, any>
}

export const updateInventoryOrderTaskStep = createStep(
  "update-inventory-order-task",
  async (input: UpdateInventoryOrderTaskInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>
    
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

    // Prepare update data
    const updateData: any = {}
    if (input.title !== undefined) updateData.title = input.title
    if (input.description !== undefined) updateData.description = input.description
    if (input.status !== undefined) updateData.status = input.status
    if (input.priority !== undefined) updateData.priority = input.priority
    if (input.due_date !== undefined) updateData.due_date = input.due_date
    if (input.metadata !== undefined) updateData.metadata = input.metadata

    // Update the task using the task service
    const taskService: TaskService = container.resolve(TASKS_MODULE)
    await taskService.updateTasks({
      selector: {
        id: input.taskId
      },
      data: {
        ...updateData
      }
    })
    
    // Fetch the updated task through the link
    const { data: updatedData } = await query.graph({
      entity: InventoryOrderTaskLink.entryPoint,
      fields: ["*", "inventory_orders.*", "task.*"],
      filters: {
        inventory_orders_id: input.inventoryOrderId,
        task_id: input.taskId
      }
    })

    return new StepResponse(updatedData[0].task, updatedData[0].task)
  }
)

export const updateInventoryOrderTaskWorkflow = createWorkflow(
  "update-inventory-order-task",
  (input: UpdateInventoryOrderTaskInput) => {
    const task = updateInventoryOrderTaskStep(input)
    
    return new WorkflowResponse(task)
  }
)
