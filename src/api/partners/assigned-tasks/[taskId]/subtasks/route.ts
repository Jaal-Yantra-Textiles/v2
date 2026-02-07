/**
 * @file Partner API routes for managing subtasks
 * @description Provides endpoints for fetching subtasks of assigned tasks in the JYT Commerce platform
 * @module API/Partner/AssignedTasks/Subtasks
 */

/**
 * @typedef {Object} PartnerAuthContext
 * @property {string} actor_id - The ID of the authenticated actor
 */

/**
 * @typedef {Object} Partner
 * @property {string} id - The unique identifier of the partner
 * @property {string} name - The name of the partner
 */

/**
 * @typedef {Object} Task
 * @property {string} id - The unique identifier of the task
 * @property {string} title - The title of the task
 * @property {string} description - The description of the task
 * @property {Object} metadata - Additional metadata for the task
 * @property {Partner[]} partners - The partners assigned to the task
 */

/**
 * @typedef {Object} Subtask
 * @property {string} id - The unique identifier of the subtask
 * @property {string} title - The title of the subtask
 * @property {string} description - The description of the subtask
 * @property {Object} metadata - Additional metadata for the subtask
 * @property {number} [metadata.order] - The order of the subtask
 */

/**
 * @typedef {Object} SubtaskResponse
 * @property {Subtask[]} subtasks - The list of subtasks
 * @property {number} count - The total number of subtasks
 */

/**
 * Fetch all subtasks for a parent task
 * @route GET /partners/assigned-tasks/{taskId}/subtasks
 * @group Partner - Operations related to partners
 * @param {string} taskId.path.required - The ID of the parent task
 * @returns {SubtaskResponse} 200 - List of subtasks for the parent task
 * @throws {MedusaError} 401 - Partner authentication required
 * @throws {MedusaError} 403 - Task not assigned to this partner
 * @throws {MedusaError} 404 - Task not found
 * @throws {MedusaError} 500 - Failed to fetch subtasks
 *
 * @example request
 * GET /partners/assigned-tasks/design_123/subtasks
 *
 * @example response 200
 * {
 *   "subtasks": [
 *     {
 *       "id": "subtask_1",
 *       "title": "Create wireframes",
 *       "description": "Create wireframes for the new homepage",
 *       "metadata": {
 *         "order": 1
 *       }
 *     },
 *     {
 *       "id": "subtask_2",
 *       "title": "Design mockups",
 *       "description": "Design mockups based on the wireframes",
 *       "metadata": {
 *         "order": 2
 *       }
 *     }
 *   ],
 *   "count": 2
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
 * @example response 500
 * {
 *   "error": "Failed to fetch subtasks",
 *   "details": "Internal server error"
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { getPartnerFromAuthContext } from "../../../helpers";
import { TASKS_MODULE } from "../../../../../modules/tasks";
import TaskService from "../../../../../modules/tasks/service";

/**
 * GET /partners/assigned-tasks/[taskId]/subtasks
 * Fetch all subtasks (child tasks) for a parent task
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const { taskId } = req.params;
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
    
    // Fetch parent task with subtasks
    const parentTask = await taskService.retrieveTask(taskId, {
      relations: ["subtasks", "outgoing", "incoming"],
    });

    if (!parentTask) {
      return res.status(404).json({ error: "Task not found" });
    }

    // Sort subtasks by order metadata
    const subtasks = (parentTask.subtasks || []).sort((a, b) => {
      const orderA = (a.metadata as any)?.order || 0;
      const orderB = (b.metadata as any)?.order || 0;
      return orderA - orderB;
    });

    res.status(200).json({
      subtasks,
      count: subtasks.length,
    });
  } catch (error) {
    console.error("Error fetching subtasks:", error);
    res.status(500).json({ 
      error: "Failed to fetch subtasks",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
