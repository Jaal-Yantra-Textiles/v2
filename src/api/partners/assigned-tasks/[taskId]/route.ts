/**
 * @file Partner API routes for fetching assigned tasks
 * @description Provides endpoints for partners to retrieve detailed information about their assigned tasks
 * @module API/Partners/AssignedTasks
 */

/**
 * @typedef {Object} PartnerTaskResponse
 * @property {string} id - The unique identifier of the task
 * @property {string} title - The title of the task
 * @property {string} description - Detailed description of the task
 * @property {string} status - Current status of the task (e.g., "pending", "in_progress", "completed")
 * @property {Date} due_date - When the task is due
 * @property {Date} created_at - When the task was created
 * @property {Date} updated_at - When the task was last updated
 * @property {Object[]} partners - Array of partners assigned to this task
 * @property {string} partners.id - Partner ID
 * @property {string} partners.name - Partner name
 * @property {Object[]} subtasks - Array of subtasks sorted by order
 * @property {string} subtasks.id - Subtask ID
 * @property {string} subtasks.title - Subtask title
 * @property {number} subtasks.metadata.order - Sorting order of the subtask
 * @property {Object[]} outgoing - Array of outgoing task relationships
 * @property {Object[]} incoming - Array of incoming task relationships
 */

/**
 * Fetch a single task assigned to the authenticated partner
 * @route GET /partners/assigned-tasks/{taskId}
 * @group Partner Tasks - Operations related to partner tasks
 * @param {string} taskId.path.required - The ID of the task to retrieve
 * @returns {Object} 200 - Task details with subtasks, relationships, and partner information
 * @throws {MedusaError} 401 - Partner authentication required
 * @throws {MedusaError} 403 - Task not assigned to this partner
 * @throws {MedusaError} 404 - Task not found
 * @throws {MedusaError} 500 - Failed to fetch task
 *
 * @example request
 * GET /partners/assigned-tasks/design_456
 *
 * @example response 200
 * {
 *   "task": {
 *     "id": "design_456",
 *     "title": "Website Redesign",
 *     "description": "Redesign the company website with new branding",
 *     "status": "in_progress",
 *     "due_date": "2023-12-15T00:00:00Z",
 *     "created_at": "2023-11-01T10:00:00Z",
 *     "updated_at": "2023-11-10T14:30:00Z",
 *     "partners": [
 *       {
 *         "id": "partner_123",
 *         "name": "Design Studio"
 *       }
 *     ],
 *     "subtasks": [
 *       {
 *         "id": "sub_001",
 *         "title": "Create wireframes",
 *         "metadata": {
 *           "order": 1
 *         }
 *       },
 *       {
 *         "id": "sub_002",
 *         "title": "Design mockups",
 *         "metadata": {
 *           "order": 2
 *         }
 *       }
 *     ],
 *     "outgoing": [],
 *     "incoming": []
 *   }
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
 *   "error": "Failed to fetch task",
 *   "details": "Database connection error"
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { getPartnerFromAuthContext } from "../../helpers";
import { TASKS_MODULE } from "../../../../modules/tasks";
import TaskService from "../../../../modules/tasks/service";

/**
 * GET /partners/assigned-tasks/[taskId]
 * Fetch a single task assigned to the authenticated partner.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { taskId } = req.params;
  const actorId = req.auth_context?.actor_id;

  if (!actorId) {
    return res.status(401).json({
      error: "Partner authentication required - no actor ID",
    });
  }

  try {
    const partner = await getPartnerFromAuthContext(req.auth_context, req.scope);

    if (!partner) {
      return res.status(401).json({
        error: "Partner authentication required - no partner found",
      });
    }

    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

    const { data: taskData } = await query.index({
      entity: "task",
      fields: ["*", "partners.*"],
      filters: {
        id: taskId,
      },
    });

    if (!taskData || taskData.length === 0) {
      return res.status(404).json({
        error: "Task not found",
      });
    }

    const task = taskData[0] as any;

    const isLinked =
      task.partners &&
      Array.isArray(task.partners) &&
      task.partners.some((p: any) => p.id === partner.id);

    if (!isLinked) {
      return res.status(403).json({
        error: "Task not assigned to this partner",
      });
    }

    const taskService: TaskService = req.scope.resolve(TASKS_MODULE);

    const retrievedTask = await taskService.retrieveTask(taskId, {
      relations: ["subtasks", "outgoing", "incoming"],
    });

    if (!retrievedTask) {
      return res.status(404).json({
        error: "Task not found",
      });
    }

    const subtasks = ((retrievedTask as any).subtasks || []).sort((a: any, b: any) => {
      const orderA = (a.metadata as any)?.order || 0;
      const orderB = (b.metadata as any)?.order || 0;
      return orderA - orderB;
    });

    ;(retrievedTask as any).subtasks = subtasks;

    return res.status(200).json({
      task: retrievedTask,
    });
  } catch (error) {
    console.error("Error fetching task:", error);
    return res.status(500).json({
      error: "Failed to fetch task",
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
