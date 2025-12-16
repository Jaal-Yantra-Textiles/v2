import {
  createWorkflow,
  createStep,
  transform,
  StepResponse,
  WorkflowResponse,
  createHook
} from "@medusajs/framework/workflows-sdk"
import { LinkDefinition } from "@medusajs/framework/types"
import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders"
import { createTaskWorkflow } from "../tasks/create-task"
import { AdminPostInventoryOrderTasksReqType } from "../../api/admin/inventory-orders/[id]/tasks/validators"
import { TASKS_MODULE } from "../../modules/tasks"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { MedusaError } from "@medusajs/utils"
import InventoryOrderService from "../../modules/inventory_orders/service"
import TaskService from "../../modules/tasks/service"
import type { Link } from "@medusajs/modules-sdk"

// Extend the validator type with inventoryOrderId
type CreateTasksInput = AdminPostInventoryOrderTasksReqType & {
  inventoryOrderId: string
}

export const validateInventoryOrderStep = createStep(
  "validate-inventory-order-step",
  async (input: CreateTasksInput, { container }) => {
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

export const validateTemplateNamesStep = createStep(
  "validate-template-names-step",
  async (input: CreateTasksInput, { container }) => {
    // Only validate if template_names are provided
    let templateNames: string[] = [];
    
    if (input.type === "template" && input.template_names) {
      templateNames = input.template_names;
    } else if (input.type === "multiple" && input.tasks) {
      // Collect template names from all tasks
      templateNames = input.tasks
        .filter(task => task.template_names)
        .flatMap(task => task.template_names || []);
    }
    
    if (templateNames.length === 0) {
      return new StepResponse({ success: true });
    }
    
    const taskService: TaskService = container.resolve(TASKS_MODULE);
    
    // Get templates by names
    const templates = await taskService.listTaskTemplates({
      name: templateNames
    });
    
    // Check if all template names exist
    const foundTemplateNames = templates.map((t: any) => t.name);
    const missingTemplateNames = templateNames.filter(name => !foundTemplateNames.includes(name));
    
    if (missingTemplateNames.length > 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Create Template's For Order: Missing templates - ${missingTemplateNames.join(', ')}`
      );
    }
    
    return new StepResponse({ success: true });
  }
)

export const determineTaskDataStep = createStep(
  "determine-task-data-step",
  async (input: any, { container }) => {

    // Handle template-based task creation response
    if (input.withTemplates) {

      return new StepResponse(input.withTemplates);
    }
    
    if (input.withParent) {

      const parentResponse = input.withParent;
      
      if ('parent' in parentResponse && 'children' in parentResponse) {
        // For parent-child relationships where parent is an object with task data (not an array)
        if (!Array.isArray(parentResponse.parent) && typeof parentResponse.parent === 'object' && 'id' in parentResponse.parent) {
          // Return the parent task object directly
          return new StepResponse([parentResponse.parent]);
        }
        
        // For parent-child relationships where parent is an array
        if (Array.isArray(parentResponse.parent) && parentResponse.parent.length > 0) {
          return new StepResponse([parentResponse.parent[0]]);
        }
      }
      
      // Handle other cases where parentResponse doesn't have expected structure
      return new StepResponse([parentResponse]);
    } 
    
    if (input.withoutTemplates) {

      return new StepResponse([input.withoutTemplates]);
    }
    

    throw new Error("No valid task response found");
  }
)

export const createInventoryOrderTaskLinksStep = createStep(
  "create-inventory-order-task-links-step",
  async (input: { tasks: any[], inventoryOrderId: string }, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    const links: LinkDefinition[] = []
    for (const task of input.tasks) {
      links.push({
        [ORDER_INVENTORY_MODULE]: {
          inventory_orders_id: input.inventoryOrderId,
        },
        [TASKS_MODULE]: {
          task_id: task.id,
        },
      })
    }

    const createdLinks = await remoteLink.create(links)
    return new StepResponse(createdLinks)
  }
)

export const createTasksFromTemplatesWorkflow = createWorkflow(
  "create-inventory-order-tasks-from-templates",
  (input: CreateTasksInput) => {
    // First validate that the inventory order exists
    const validateStep = validateInventoryOrderStep(input);
    
    // Validate that template names exist in the database
    const validateTemplatesStep = validateTemplateNamesStep(input);
    
    // Transform input to match CreateTaskStepInput | CreateTaskWithParentInput
    const transformedInput = transform(
      { input },
      (data) => {
        const { inventoryOrderId, ...taskInput } = data.input;
        // CRITICAL: Ensure that workflow input metadata (including assignment_notes) 
        // is preserved and will be merged with template metadata
        if ('metadata' in taskInput && taskInput.metadata) {
        }
        console.log(taskInput)
        
        return taskInput;
      }
    );

    // Create tasks with templates
    const createTasksStep = createTaskWorkflow.runAsStep({
      input: transformedInput
    });
    
    // Determine task data from the response
    const taskDataStep = determineTaskDataStep(createTasksStep);

    // Create links for all tasks
    const createLinksStep = createInventoryOrderTaskLinksStep({
      tasks: taskDataStep,
      inventoryOrderId: input.inventoryOrderId
    });

    const inventoryOrderTaskCreated = createHook(
      "inventoryOrderTaskCreated", 
      { 
       inventoryOrderId: input.inventoryOrderId,
       tasks: taskDataStep
      }
    )
        
    return new WorkflowResponse([validateStep, createTasksStep, createLinksStep], {
      hooks: [inventoryOrderTaskCreated]
    });
  }
)
