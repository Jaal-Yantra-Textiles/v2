import { MedusaError } from "@medusajs/utils"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createTasksFromTemplatesWorkflow } from "../../../../../workflows/inventory_orders/create-tasks-from-templates"
import { getInventoryOrderTasksWorkflow } from "../../../../../workflows/inventory_orders/get-inventory-order-tasks"
import { AdminPostInventoryOrderTasksReqType } from "./validators"
import { refetchTask } from "./helpers"


export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const fields = req.query.fields ? (req.query.fields as string).split(',') : undefined
  console.log(req.queryConfig)
  // Use the workflow which handles validation and retrieval
  const { result } = await getInventoryOrderTasksWorkflow(req.scope).run({
    input: {
      inventoryOrderId: id,
      fields
    }
  })

  // The tasks are in the second step's result (index 1)
  // We access the tasks from the StepResponse returned by getInventoryOrderTasksStep
  return res.status(200).json({
    tasks: result.tasks || []
  })
}

export const POST = async (req: MedusaRequest<AdminPostInventoryOrderTasksReqType>, res: MedusaResponse) => {
  const { id } = req.params
  
  try {
    // Validation is handled within the workflow
    // Run workflow with validated body
    const { result } = await createTasksFromTemplatesWorkflow(req.scope).run({
      input: {
        ...req.validatedBody,
        inventoryOrderId: id,
      },
    });

    // First result is validation, second is the task creation result, third is the links
    const taskLinks = result[2] || [];
    
    // Get task IDs from links
    const taskIds: string[] = [];
    
    // Process each link and extract the task ID
    for (const link of taskLinks) {
      // Use type assertion to access properties safely
      const linkObj = link as Record<string, any>;
      
      // Check for different possible property names based on the response format
      if (linkObj && typeof linkObj === 'object') {
        if (linkObj.task_id) {
          taskIds.push(linkObj.task_id);
        } else if (linkObj.tasks_id) {
          taskIds.push(linkObj.tasks_id);
        }
      }
    }
    
    // Fetch full task details if we have IDs
    let tasks: any[] = [];
    
    if (taskIds.length > 0) {
      const fetchedTasks = await refetchTask(taskIds, req.scope, ["*", 'subtasks.*']);
      tasks = Array.isArray(fetchedTasks) ? fetchedTasks : [fetchedTasks];
    }

    return res.status(200).json({
      taskLinks: {
        list: tasks,
        count: taskLinks.length,
      },
      message: `Inventory Order ${id} successfully created ${taskLinks.length} tasks`,
    });
  } catch (error) {
    return res.status(400).json({
      message: `Error creating tasks for inventory order: ${error.message}`,
      error: error
    });
  }
}
