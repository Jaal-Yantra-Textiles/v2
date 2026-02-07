/**
 * @file Partner API routes for managing assigned tasks
 * @description Provides endpoints for retrieving tasks assigned to partners in the JYT Commerce platform
 * @module API/Partner/AssignedTasks
 */

/**
 * @typedef {Object} Task
 * @property {string} id - The unique identifier for the task
 * @property {string} title - The title of the task
 * @property {string} description - Detailed description of the task
 * @property {string} status - Current status of the task (e.g., "pending", "in_progress", "completed")
 * @property {string} priority - Priority level of the task (e.g., "low", "medium", "high")
 * @property {Date} due_date - The due date for the task completion
 * @property {Date} created_at - When the task was created
 * @property {Date} updated_at - When the task was last updated
 * @property {string} [parent_task_id] - ID of the parent task if this is a subtask
 * @property {Array<Task>} [subtasks] - List of subtasks associated with this task
 * @property {Array<Object>} [outgoing] - Outgoing relationships or dependencies
 * @property {Array<Object>} [incoming] - Incoming relationships or dependencies
 */

/**
 * @typedef {Object} AssignedTasksResponse
 * @property {Array<Task>} tasks - List of tasks assigned to the partner
 * @property {number} count - Total number of tasks returned
 */

/**
 * List all standalone tasks assigned to the authenticated partner
 * @route GET /partners/assigned-tasks
 * @group Partner Tasks - Operations related to partner tasks
 * @returns {AssignedTasksResponse} 200 - List of tasks assigned to the partner
 * @throws {MedusaError} 401 - Partner authentication required - no actor ID
 * @throws {MedusaError} 401 - No partner found for this user
 * @throws {MedusaError} 500 - Failed to fetch assigned tasks
 *
 * @example request
 * GET /partners/assigned-tasks
 *
 * @example response 200
 * {
 *   "tasks": [
 *     {
 *       "id": "task_123456789",
 *       "title": "Design Review",
 *       "description": "Review the latest design submissions",
 *       "status": "pending",
 *       "priority": "high",
 *       "due_date": "2023-12-31T23:59:59Z",
 *       "created_at": "2023-10-01T00:00:00Z",
 *       "updated_at": "2023-10-01T00:00:00Z",
 *       "parent_task_id": null,
 *       "subtasks": [
 *         {
 *           "id": "task_987654321",
 *           "title": "Subtask 1",
 *           "description": "Review design A",
 *           "status": "in_progress",
 *           "priority": "medium",
 *           "due_date": "2023-11-15T23:59:59Z",
 *           "created_at": "2023-10-02T00:00:00Z",
 *           "updated_at": "2023-10-02T00:00:00Z",
 *           "parent_task_id": "task_123456789"
 *         }
 *       ],
 *       "outgoing": [],
 *       "incoming": []
 *     }
 *   ],
 *   "count": 1
 * }
 *
 * @example response 401
 * {
 *   "message": "Partner authentication required - no actor ID"
 * }
 *
 * @example response 401
 * {
 *   "message": "No partner found for this user"
 * }
 *
 * @example response 500
 * {
 *   "message": "Failed to fetch assigned tasks",
 *   "error": "Internal server error"
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { getPartnerFromAuthContext } from "../helpers";
import { TASKS_MODULE } from "../../../modules/tasks";
import TaskService from "../../../modules/tasks/service";

/**
 * GET /partners/assigned-tasks
 * Lists all standalone tasks assigned to the authenticated partner
 * These are tasks assigned directly to the partner (not through designs or other entities)
 */
export async function GET(
    req: AuthenticatedMedusaRequest,
    res: MedusaResponse
) {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
    
    const actorId = req.auth_context?.actor_id;
    
    if (!actorId) {
        return res.status(401).json({ 
            message: "Partner authentication required - no actor ID" 
        });
    }

    try {
        const partner = await getPartnerFromAuthContext(req.auth_context, req.scope);
        
        if (!partner) {
            throw new MedusaError(
                MedusaError.Types.UNAUTHORIZED, 
                "No partner found for this user"
            );
        }

        // Query all tasks linked to this partner
        const { data: partnerData } = await query.graph({
            entity: 'partner',
            fields: [ '*','tasks.*', 'tasks.outgoing.*', 'tasks.incoming.*', 'tasks.subtasks.*'],
            filters: {
                id: partner.id
            }
        });
        // Extract the tasks from the partner object
        let allTaskIds: any[] = [];
        if (partnerData && partnerData.length > 0) {
            const partner = partnerData[0];
            if (Array.isArray(partner.tasks)) {
                allTaskIds = partner.tasks.map((t: any) => t.id);
            }
        }

        if (allTaskIds.length === 0) {
            return res.status(200).json({ 
                tasks: [],
                count: 0
            });
        }

        // Now fetch the tasks with their subtasks using the task service
        const taskService: TaskService = req.scope.resolve(TASKS_MODULE);
        
        const allTasks = await taskService.listTasks(
            { id: allTaskIds },
            { relations: ["subtasks", "outgoing", "incoming"] }
        );

        // Filter to only show parent tasks (exclude subtasks)
        // Subtasks have parent_task_id set, parent tasks have it as null
        const parentTasks = allTasks.filter((task: any) => !task.parent_task_id);

        res.status(200).json({ 
            tasks: parentTasks,
            count: parentTasks.length
        });
    } catch (error) {
        console.error("Error fetching assigned tasks:", error);
        res.status(500).json({ 
            message: "Failed to fetch assigned tasks",
            error: error instanceof Error ? error.message : String(error)
        });
    }
}
