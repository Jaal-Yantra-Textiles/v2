
/**
 * API handlers for managing tasks on a design resource.
 *
 * Exposes three route handlers for the endpoint pattern:
 *   /api/admin/designs/:id/tasks/:taskId
 *
 * Common behavior
 * - Each handler expects req.params to include:
 *     - id: string (design id)
 *     - taskId: string (task id)
 * - Each handler validates that the design exists using refetchEntity.
 * - If the design is not found, a MedusaError with type NOT_FOUND is thrown.
 *
 * GET(req, res)
 * - Description: Fetch a single task belonging to a design.
 * - Params:
 *     - req: MedusaRequest with req.params.id and req.params.taskId
 *     - res: MedusaResponse
 * - Returns: JSON { task: Task } where Task is the found task object.
 * - Errors: Throws MedusaError.Types.NOT_FOUND when the design does not exist.
 * - Example:
 *   fetch("/api/admin/designs/123/tasks/abc", { method: "GET", credentials: "include" })
 *     .then(r => r.json())
 *     .then(data => {
 *       // data.task -> { id: "abc", title: "...", status: "...", ... }
 *     });
 *
 * POST(req, res)
 * - Description: Update a task on a design. Request body must conform to UpdateDesignTask validator.
 * - Params:
 *     - req: MedusaRequest<UpdateDesignTask> with req.params.id, req.params.taskId and req.validatedBody (update payload)
 *     - res: MedusaResponse
 * - Returns: JSON { task: Task } with the updated task object.
 * - Errors: Throws MedusaError.Types.NOT_FOUND when the design does not exist.
 * - Example:
 *   fetch("/api/admin/designs/123/tasks/abc", {
 *     method: "POST",
 *     headers: { "Content-Type": "application/json" },
 *     body: JSON.stringify({ title: "New title", status: "in_progress" }),
 *     credentials: "include"
 *   })
 *     .then(r => r.json())
 *     .then(data => {
 *       // data.task -> updated task object
 *     });
 *
 * DELETE(req, res)
 * - Description: Delete a task from a design.
 * - Params:
 *     - req: MedusaRequest with req.params.id and req.params.taskId
 *     - res: MedusaResponse
 * - Returns: JSON { id: string, object: "task", deleted: true } on success.
 * - Errors: Throws MedusaError.Types.NOT_FOUND when the design does not exist.
 * - Example:
 *   fetch("/api/admin/designs/123/tasks/abc", { method: "DELETE", credentials: "include" })
 *     .then(r => r.json())
 *     .then(data => {
 *       // data -> { id: "abc", object: "task", deleted: true }
 *     });
 *
 * Notes
 * - Authentication/authorization is expected to be handled via req.scope.
 * - Validation of update payload is performed before running the update workflow.
 */
import { MedusaError } from "@medusajs/utils"
import { MedusaRequest, MedusaResponse, refetchEntity } from "@medusajs/framework"
import { getDesignTaskWorkflow } from "../../../../../../workflows/designs/get-design-task"
import { updateDesignTaskWorkflow } from "../../../../../../workflows/designs/update-design-task"
import { deleteDesignTaskWorkflow } from "../../../../../../workflows/designs/delete-design-task"
import { UpdateDesignTask } from "./validators"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id, taskId } = req.params
  
  // Validate design exists
  const designExists = await refetchEntity({
    entity: "design",
    idOrFilter: id,
    scope: req.scope,
    fields: ["id"]
  })
  

  if (!designExists) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Design with id ${id} was not found`
    )
  }
  
  const { result: task } = await getDesignTaskWorkflow(req.scope).run({
      input: {
        designId: id,
        taskId
      }
  })

 
  return res.json({
    task: task[0]
  })
}

export const POST = async (req: MedusaRequest<UpdateDesignTask>, res: MedusaResponse) => {
  const { id, taskId } = req.params
  
  // Validate design exists
  const designExists = await refetchEntity({
    entity: "design",
    idOrFilter: id,
    scope: req.scope,
    fields: ["id"]
  })

  if (!designExists) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Design with id ${id} was not found`
    )
  }

  const { result: task } = await updateDesignTaskWorkflow(req.scope).run({
    input: {
      designId: id,
      taskId,
      update: req.validatedBody
    }
  })

  return res.json({
    task
  })
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id, taskId } = req.params
  
  // Validate design exists
  const designExists = await refetchEntity({
    entity: "design",
    idOrFilter: id,
    scope: req.scope,
    fields: ["id"]
  })

  if (!designExists) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Design with id ${id} was not found`
    )
  }

  await deleteDesignTaskWorkflow(req.scope).run({
    input: {
      designId: id,
      taskId
    }
  })

  return res.status(200).json({
    id: taskId,
    object: "task",
    deleted: true
  })
}
