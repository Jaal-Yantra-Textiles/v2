import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders"
import { TASKS_MODULE } from "../../modules/tasks"
import { MedusaError } from "@medusajs/utils"
import InventoryOrderService from "../../modules/inventory_orders/service"
import inventoryOrdersTasks from "../../links/inventory-orders-tasks"
import type { RemoteQueryFunction } from "@medusajs/types"

type GetInventoryOrderTasksInput = {
  inventoryOrderId: string
  fields?: string[]
}

export const validateInventoryOrderStep = createStep(
  "validate-inventory-order-step",
  async (input: GetInventoryOrderTasksInput, { container }) => {
    const inventoryOrderService: InventoryOrderService = container.resolve(ORDER_INVENTORY_MODULE)
    
    try {
      await inventoryOrderService.retrieveInventoryOrder(input.inventoryOrderId, {
        select: ["id"]
      })
      return new StepResponse({ success: true })
    } catch (error) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Inventory Order with id ${input.inventoryOrderId} was not found`
      )
    }
  }
)

export const getInventoryOrderTasksStep = createStep(
  "get-inventory-order-tasks-step",
  async (input: GetInventoryOrderTasksInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>
    
    // Prepare fields configuration with proper prefixing
    // If no fields specified, include task.* to get all task data
    let fieldsConfig: string[]
    
    if (input.fields?.length) {
      // Prefix each field with 'task.' if it's not already prefixed
      fieldsConfig = input.fields.map(field => 
        field.startsWith('task.') ? field : `task.${field}`
      )
    } else {
      // Default fields if none specified
      fieldsConfig = ["task.*"]
    }
    
    // Get all tasks by IDs using query.graph
    const result = await query.graph({
      entity: inventoryOrdersTasks.entryPoint,
      filters: { 
        inventory_orders_id: input.inventoryOrderId
      },
      fields: fieldsConfig
    })

    // Extract just the task objects from the result
    const tasks = result.data?.map(item => item.task) || []
    
    return new StepResponse({ tasks })
  }
)

export const getInventoryOrderTasksWorkflow = createWorkflow(
  "get-inventory-order-tasks",
  (input: GetInventoryOrderTasksInput) => {
    // First validate that the inventory order exists
    const validateStep = validateInventoryOrderStep(input)
    
    // Then get all tasks linked to the inventory order
    const tasksStep = getInventoryOrderTasksStep(input)
    
    return new WorkflowResponse(tasksStep)
  }
)
