/**
 * Admin Inventory Order Tasks API
 *
 * Base path:
 *   /admin/inventory-orders/:id/tasks
 *
 * Authentication:
 *   Requires admin authentication (e.g. Authorization: Bearer <ADMIN_TOKEN>)
 *
 * Endpoints:
 *
 * 1) GET /admin/inventory-orders/:id/tasks
 *    - Query parameters:
 *        - fields (optional): comma-separated list of task fields to include
 *          Example: ?fields=id,status,assignee
 *    - Response: 200
 *        {
 *          "tasks": [ /* array of task objects, may be empty *\/ ]
 *        }
 *    - Errors:
 *        400 — invalid request
 *        401 — unauthorized
 *        404 — inventory order not found
 *
 *    Example (curl):
 *      curl -X GET "https://api.example.com/admin/inventory-orders/io_123/tasks?fields=id,status" \
 *        -H "Authorization: Bearer ADMIN_TOKEN"
 *
 *    Example (fetch):
 *      await fetch("/admin/inventory-orders/io_123/tasks?fields=id,status", {
 *        method: "GET",
 *        headers: { "Authorization": "Bearer ADMIN_TOKEN" }
 *      }).then(r => r.json())
 *
 *
 * 2) POST /admin/inventory-orders/:id/tasks
 *    - Purpose: Create tasks for an inventory order from templates.
 *    - Body: validated against AdminPostInventoryOrderTasksReqType (server-side validation).
 *      Example body (illustrative):
 *        {
 *          "templates": [
 *            { "template_id": "tmpl_1", "quantity": 2 },
 *            { "template_id": "tmpl_2", "quantity": 1 }
 *          ],
 *          "options": { "priority": "high", "notify": true }
 *        }
 *    - Response: 200
 *        {
 *          "taskLinks": {
 *            "list": [ /* full task objects (refetched) *\/ ],
 *            "count": 2
 *          },
 *          "message": "Inventory Order io_123 successfully created 2 tasks"
 *        }
 *    - Errors:
 *        400 — validation or creation error (response includes error message)
 *        401 — unauthorized
 *        404 — inventory order or template not found
 *
 *    Example (curl):
 *      curl -X POST "https://api.example.com/admin/inventory-orders/io_123/tasks" \
 *        -H "Authorization: Bearer ADMIN_TOKEN" \
 *        -H "Content-Type: application/json" \
 *        -d '{
 *          "templates": [
 *            { "template_id": "tmpl_1", "quantity": 2 }
 *          ],
 *          "options": { "notify": true }
 *        }'
 *
 *    Example (fetch):
 *      await fetch("/admin/inventory-orders/io_123/tasks", {
 *        method: "POST",
 *        headers: {
 *          "Authorization": "Bearer ADMIN_TOKEN",
 *          "Content-Type": "application/json"
 *        },
 *        body: JSON.stringify({
 *          templates: [{ template_id: "tmpl_1", quantity: 2 }],
 *          options: { notify: true }
 *        })
 *      }).then(r => r.json())
 *
 * Notes:
 *  - Validation of POST payload is performed by the workflow using AdminPostInventoryOrderTasksReqType.
 *  - The POST response includes a refetched list of created tasks (taskLinks.list) and a count.
 *  - Use the `fields` query on GET to limit returned task fields and reduce payload size.
 */
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
