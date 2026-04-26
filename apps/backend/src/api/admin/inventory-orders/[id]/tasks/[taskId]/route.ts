/**
 * Admin Inventory Order Task API
 *
 * Base path
 *   /admin/inventory-orders/:id/tasks/:taskId
 *
 * Authentication
 *   - Admin scope required (handled via req.scope)
 *
 * Path parameters
 *   - id: string (inventory order id)
 *   - taskId: string (task id)
 *
 * GET
 *   - Description: Fetch a single task for an inventory order.
 *   - Response 200:
 *     {
 *       "task": {
 *         "id": "task_123",
 *         "inventory_order_id": "io_456",
 *         "title": "Cut fabric",
 *         "description": "Cut 10m of main textile",
 *         "status": "open", // e.g. open, in_progress, completed
 *         "assignee": "partner_789",
 *         "due_date": "2026-01-20T00:00:00.000Z",
 *         "created_at": "2026-01-10T12:00:00.000Z",
 *         "updated_at": "2026-01-11T08:30:00.000Z",
 *         // ...other task fields
 *       }
 *     }
 *   - Example:
 *     curl -X GET "https://api.example.com/admin/inventory-orders/io_456/tasks/task_123" \
 *       -H "Authorization: Bearer <ADMIN_TOKEN>"
 *
 * POST
 *   - Description: Update a task (fields validated by UpdateInventoryOrderTask).
 *   - Request body (example):
 *     {
 *       "title": "Cut main fabric",
 *       "description": "Cut 12m instead of 10m",
 *       "status": "in_progress",
 *       "assignee": "partner_999",
 *       "due_date": "2026-01-22T00:00:00.000Z"
 *     }
 *   - Response 200:
 *     {
 *       "task": { /* updated task object, same shape as GET *\/ }
 *     }
 *   - Example:
 *     curl -X POST "https://api.example.com/admin/inventory-orders/io_456/tasks/task_123" \
 *       -H "Authorization: Bearer <ADMIN_TOKEN>" \
 *       -H "Content-Type: application/json" \
 *       -d '{"status":"in_progress","assignee":"partner_999"}'
 *
 * DELETE
 *   - Description: Delete a task from the inventory order.
 *   - Response 200:
 *     {
 *       "id": "task_123",
 *       "object": "task",
 *       "deleted": true
 *     }
 *   - Example:
 *     curl -X DELETE "https://api.example.com/admin/inventory-orders/io_456/tasks/task_123" \
 *       -H "Authorization: Bearer <ADMIN_TOKEN>"
 *
 * Errors
 *   - 404 NOT_FOUND: Inventory order not found
 *     {
 *       "type": "not_found",
 *       "message": "Inventory order with id io_456 was not found"
 *     }
 *   - Other errors returned using MedusaError shapes (INVALID_DATA, CONFLICT, FORBIDDEN, etc.)
 */
import { MedusaError } from "@medusajs/utils"
import { MedusaRequest, MedusaResponse, refetchEntity } from "@medusajs/framework"
import { getInventoryOrderTaskWorkflow } from "../../../../../../workflows/inventory_orders/get-inventory-order-task"
import { UpdateInventoryOrderTask } from "./validators"
import { updateInventoryOrderTaskWorkflow } from "../../../../../../workflows/inventory_orders/update-inventory-order-task"
import { deleteInventoryOrderTaskWorkflow } from "../../../../../../workflows/inventory_orders/delete-inventory-order-task"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id, taskId } = req.params
  
  // Validate inventory order exists
  const inventoryOrderExists = await refetchEntity({
    entity: "inventory_orders",
    idOrFilter: id,
    scope: req.scope,
    fields: ["id"]
  })
  

  if (!inventoryOrderExists) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Inventory order with id ${id} was not found`
    )
  }
  
  const { result: task } = await getInventoryOrderTaskWorkflow(req.scope).run({
      input: {
        inventoryOrderId: id,
        taskId
      }
  })

 
  return res.json({
    task: task
  })
}

export const POST = async (req: MedusaRequest<UpdateInventoryOrderTask>, res: MedusaResponse) => {
  const { id, taskId } = req.params
  
  // Validate inventory order exists
  const inventoryOrderExists = await refetchEntity({
    entity: "inventory_orders",
    idOrFilter: id,
    scope: req.scope,
    fields: ["id"]
  })

  if (!inventoryOrderExists) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Inventory order with id ${id} was not found`
    )
  }

  const { result: task } = await updateInventoryOrderTaskWorkflow(req.scope).run({
    input: {
      inventoryOrderId: id,
      taskId,
      ...req.validatedBody
    }
  })

  return res.json({
    task: task
  })
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id, taskId } = req.params
  
  // Validate inventory order exists
  const inventoryOrderExists = await refetchEntity({
    entity: "inventory_orders",
    idOrFilter: id,
    scope: req.scope,
    fields: ["id"]
  })

  if (!inventoryOrderExists) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Inventory order with id ${id} was not found`
    )
  }

  await deleteInventoryOrderTaskWorkflow(req.scope).run({
    input: {
      inventoryOrderId: id,
      taskId
    }
  })

  return res.status(200).json({
    id: taskId,
    object: "task",
    deleted: true
  })
}
