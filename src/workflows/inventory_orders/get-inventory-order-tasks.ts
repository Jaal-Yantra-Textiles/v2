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
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    // Prepare fields configuration
    // If no fields specified, include tasks.* to get all task data
    const fieldsConfig = input.fields?.length ? input.fields : ["tasks.*", "tasks.subtasks.*"]

    // Get all tasks by IDs using query.graph
    const result = await query.graph({
      entity: ORDER_INVENTORY_MODULE,
      filters: { id: input.inventoryOrderId },
      fields: fieldsConfig
    })
    return new StepResponse({ tasks: result.data })
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
