/**
 * @file Partner Task Acceptance API
 * @description Provides endpoints for partners to accept assigned tasks in the JYT Commerce platform
 * @module API/Partners/Tasks
 */

/**
 * @typedef {Object} TaskAcceptanceResponse
 * @property {Object} task - The updated task object
 * @property {string} task.id - The unique identifier of the task
 * @property {string} task.status - The status of the task (accepted)
 * @property {string} task.title - The title of the task
 * @property {string} task.description - The description of the task
 * @property {Date} task.created_at - When the task was created
 * @property {Date} task.updated_at - When the task was last updated
 * @property {Object[]} task.partners - Array of partners assigned to the task
 * @property {string} task.partners.id - The unique identifier of the partner
 * @property {string} task.partners.name - The name of the partner
 * @property {string} message - Success message
 */

/**
 * Partner accepts a standalone task assignment
 * @route POST /partners/assigned-tasks/:taskId/accept
 * @group Task - Operations related to partner tasks
 * @param {string} taskId.path.required - The ID of the task to accept
 * @returns {TaskAcceptanceResponse} 200 - Task successfully accepted
 * @throws {MedusaError} 401 - Unauthorized - Partner authentication required or no partner associated with this admin
 * @throws {MedusaError} 403 - Forbidden - Task not assigned to this partner
 * @throws {MedusaError} 404 - Not Found - Task not found
 * @throws {MedusaError} 500 - Internal Server Error - Failed to accept task
 *
 * @example request
 * POST /partners/assigned-tasks/task_123456789/accept
 *
 * @example response 200
 * {
 *   "task": {
 *     "id": "task_123456789",
 *     "status": "accepted",
 *     "title": "Website Redesign",
 *     "description": "Redesign the company website with new branding",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-15T10:30:00Z",
 *     "partners": [
 *       {
 *         "id": "partner_987654321",
 *         "name": "Design Studio"
 *       }
 *     ]
 *   },
 *   "message": "Task accepted successfully"
 * }
 *
 * @example response 401
 * {
 *   "message": "Partner authentication required"
 * }
 *
 * @example response 403
 * {
 *   "message": "Task not assigned to this partner"
 * }
 *
 * @example response 404
 * {
 *   "message": "Task not found"
 * }
 *
 * @example response 500
 * {
 *   "message": "Failed to accept task",
 *   "error": "Internal server error"
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { updateTaskWorkflow } from "../../../../../workflows/tasks/update-task";
import { setStepSuccessWorkflow } from "../../../../../workflows/tasks/task-engine/task-steps";
import { Status } from "../../../../../workflows/tasks/create-task";
import { getPartnerFromAuthContext } from "../../../helpers";

/**
 * POST /partners/assigned-tasks/[taskId]/accept
 * Partner accepts a standalone task assignment
 */
export async function POST(
    req: AuthenticatedMedusaRequest,
    res: MedusaResponse
) {
    const taskId = req.params.taskId;
    const actorId = req.auth_context?.actor_id;
    
    if (!actorId) {
        throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Partner authentication required");
    }

    try {
        // Fetch the partner associated with this admin
        const partner = await getPartnerFromAuthContext(req.auth_context, req.scope);
        
        if (!partner) {
            throw new MedusaError(
                MedusaError.Types.UNAUTHORIZED, 
                "No partner associated with this admin"
            );
        }

        // Verify the task is assigned to this partner
        const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
        const { data: taskData } = await query.index({
            entity: 'task',
            fields: ["*","partners.*"],
            filters: {
               id: taskId
            }
        });
        
        if (!taskData || taskData.length === 0) {
            return res.status(404).json({ 
                message: "Task not found" 
            });
        }

        const task = taskData[0] as any;
        
        // Check if task is linked to this partner
        const isLinked = task.partners && Array.isArray(task.partners) && 
                         task.partners.some((p: any) => p.id === partner.id);
        
        if (!isLinked) {
            return res.status(403).json({ 
                message: "Task not assigned to this partner" 
            });
        }

        // Update task status to accepted
        const { result, errors } = await updateTaskWorkflow(req.scope).run({
            input: {
                id: taskId,
                update: {
                    status: Status.accepted
                }
            }
        });

        if (errors && errors.length > 0) {
            console.warn("Error updating task:", errors);
            throw errors;
        }

        /**
         * Signal the workflow step for task acceptance
         * This will only succeed if there's an active workflow waiting
         * If no workflow exists, it will fail silently (caught error)
         */
        await setStepSuccessWorkflow(req.scope).run({
            input: {
                stepId: 'await-task-claim',
                updatedTask: result[0]
            }
        }).catch((error) => {
            // Don't throw - task is already updated
            // This is expected for standalone tasks without workflows
        });

        res.status(200).json({ 
            task: result[0],
            message: "Task accepted successfully"
        });

    } catch (error) {
        console.error("Error accepting task:", error);
        res.status(500).json({ 
            message: "Failed to accept task",
            error: error.message 
        });
    }
}
