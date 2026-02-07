/**
 * @file Partner API route for completing subtasks
 * @description Provides endpoint for partners to mark subtasks as completed within assigned tasks
 * @module API/Partners/Tasks
 */

/**
 * @typedef {Object} SubtaskCompletionResponse
 * @property {Object} subtask - The updated subtask object
 * @property {string} subtask.id - The unique identifier of the subtask
 * @property {string} subtask.status - The status of the subtask (completed)
 * @property {Date} subtask.completed_at - When the subtask was completed
 * @property {boolean} parent_completed - Whether the parent task was completed as a result
 * @property {string} message - Human-readable message about the operation result
 */

/**
 * Mark a subtask as completed
 * @route POST /partners/assigned-tasks/:taskId/subtasks/:subtaskId/complete
 * @group Task - Operations related to tasks and subtasks
 * @param {string} taskId.path.required - The ID of the parent task
 * @param {string} subtaskId.path.required - The ID of the subtask to complete
 * @returns {SubtaskCompletionResponse} 200 - Subtask completion result
 * @throws {MedusaError} 401 - Partner authentication required
 * @throws {MedusaError} 403 - Task not assigned to this partner
 * @throws {MedusaError} 404 - Task or subtask not found
 * @throws {MedusaError} 400 - Invalid task state or subtask relationship
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * POST /partners/assigned-tasks/task_12345/subtasks/subtask_67890/complete
 *
 * @example response 200
 * {
 *   "subtask": {
 *     "id": "subtask_67890",
 *     "status": "completed",
 *     "completed_at": "2023-11-15T14:30:00Z"
 *   },
 *   "parent_completed": true,
 *   "message": "Subtask completed and all tasks finished!"
 * }
 *
 * @example response 401
 * {
 *   "error": "Partner authentication required - no actor ID"
 * }
 *
 * @example response 403
 * {
 *   "error": "Task not assigned to this partner"
 * }
 *
 * @example response 404
 * {
 *   "error": "Task not found"
 * }
 *
 * @example response 400
 * {
 *   "error": "Parent task must be accepted before completing subtasks",
 *   "parent_status": "pending"
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { getPartnerFromAuthContext } from "../../../../../helpers";
import { TASKS_MODULE } from "../../../../../../../modules/tasks";
import TaskService from "../../../../../../../modules/tasks/service";

/**
 * POST /partners/assigned-tasks/[taskId]/subtasks/[subtaskId]/complete
 * Mark a subtask as completed
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const { taskId, subtaskId } = req.params;
  const actorId = req.auth_context?.actor_id;
  
  if (!actorId) {
    return res.status(401).json({ 
      error: "Partner authentication required - no actor ID" 
    });
  }

  try {
    const partner = await getPartnerFromAuthContext(req.auth_context, req.scope);
    
    if (!partner) {
      return res.status(401).json({ 
        error: "Partner authentication required - no partner found" 
      });
    }

    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
    
    // Verify parent task is assigned to this partner
    const { data: taskData } = await query.index({
      entity: 'task',
      fields: ["*", "partners.*"],
      filters: {
        id: taskId
      }
    });

    if (!taskData || taskData.length === 0) {
      return res.status(404).json({ 
        error: "Task not found" 
      });
    }

    const task = taskData[0] as any;
    
    // Check if task is linked to this partner
    const isLinked = task.partners && Array.isArray(task.partners) && 
                     task.partners.some((p: any) => p.id === partner.id);
    
    if (!isLinked) {
      return res.status(403).json({ 
        error: "Task not assigned to this partner" 
      });
    }

    const taskService: TaskService = req.scope.resolve(TASKS_MODULE);
    
    // First, verify parent task is accepted
    const parentTask = await taskService.retrieveTask(taskId);
    
    if (!parentTask) {
      return res.status(404).json({ error: "Parent task not found" });
    }

    if (parentTask.status !== "accepted" && parentTask.status !== "in_progress") {
      return res.status(400).json({ 
        error: "Parent task must be accepted before completing subtasks",
        parent_status: parentTask.status
      });
    }

    // Verify subtask belongs to parent task
    const subtask = await taskService.retrieveTask(subtaskId, {
      relations: ["parent_task"],
    });

    if (!subtask) {
      return res.status(404).json({ error: "Subtask not found" });
    }

    if (subtask.parent_task?.id !== taskId) {
      return res.status(400).json({ 
        error: "Subtask does not belong to this task" 
      });
    }

    // Update subtask status to completed
    const updatedSubtask = await taskService.updateTasks({
      id: subtaskId,
      status: "completed",
      completed_at: new Date(),
    });

    // Check if all subtasks are completed - refetch parent with subtasks
    const parentTaskWithSubtasks = await taskService.retrieveTask(taskId, {
      relations: ["subtasks"],
    });

    const allSubtasksCompleted = parentTaskWithSubtasks.subtasks?.every(
      (st) => st.status === "completed"
    ) || false;

    let parentCompleted = false;

    // If all subtasks are completed, complete the parent task
    if (allSubtasksCompleted && (parentTaskWithSubtasks as any).status !== "completed") {
      await taskService.updateTasks({
        id: taskId,
        status: "completed",
        completed_at: new Date(),
      });
      parentCompleted = true;
    }

    res.status(200).json({
      subtask: updatedSubtask,
      parent_completed: parentCompleted,
      message: parentCompleted 
        ? "Subtask completed and all tasks finished!" 
        : "Subtask completed successfully",
    });
  } catch (error) {
    console.error("Error completing subtask:", error);
    res.status(500).json({ 
      error: "Failed to complete subtask",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
