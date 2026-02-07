/**
 * @file Partner Task Acceptance API
 * @description Provides endpoints for partners to accept tasks in the JYT Commerce platform
 * @module API/Partners/Tasks
 */

/**
 * @typedef {Object} TaskAcceptanceResponse
 * @property {Object} task - The updated task object
 * @property {string} task.id - The unique identifier of the task
 * @property {string} task.status - The status of the task (e.g., "accepted")
 * @property {string} task.title - The title of the task
 * @property {string} task.description - The description of the task
 * @property {Date} task.created_at - When the task was created
 * @property {Date} task.updated_at - When the task was last updated
 * @property {string} task.partner_id - The ID of the partner assigned to the task
 * @property {string} task.project_id - The ID of the project associated with the task
 * @property {Object[]} task.steps - The steps associated with the task
 * @property {string} task.steps.id - The unique identifier of the step
 * @property {string} task.steps.status - The status of the step (e.g., "success")
 * @property {string} task.steps.name - The name of the step
 */

/**
 * Accept a task
 * @route POST /partners/tasks/:taskId/accept
 * @group Task - Operations related to tasks
 * @param {string} taskId.path.required - The ID of the task to accept
 * @returns {TaskAcceptanceResponse} 200 - The updated task object
 * @throws {MedusaError} 400 - Invalid task ID or task cannot be accepted
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Task not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * POST /partners/tasks/task_123456789/accept
 *
 * @example response 200
 * {
 *   "task": {
 *     "id": "task_123456789",
 *     "status": "accepted",
 *     "title": "Design Homepage",
 *     "description": "Create a new homepage design for the JYT Commerce platform",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-02T00:00:00Z",
 *     "partner_id": "partner_987654321",
 *     "project_id": "project_123456789",
 *     "steps": [
 *       {
 *         "id": "step_123456789",
 *         "status": "success",
 *         "name": "await-task-claim"
 *       }
 *     ]
 *   }
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { updateTaskWorkflow } from "../../../../../workflows/tasks/update-task";
import { setStepSuccessWorkflow } from "../../../../../workflows/tasks/task-engine/task-steps";
import { Status } from "../../../../../workflows/tasks/create-task";

export async function POST(
    req: AuthenticatedMedusaRequest,
    res: MedusaResponse
) {

    const taskId = req.params.taskId
    
    const { result, errors } = await updateTaskWorkflow(req.scope).run({
        input: {
            id: taskId,
            update:{
                status: Status.accepted
            }
        }
    })
    if (errors && errors.length > 0) {    
        console.warn("Error reported at", errors);
        throw errors;
    }
    /**
     * Here the partner is not notified but set the claim task success
     */
    const setStepSuccess = await setStepSuccessWorkflow(req.scope).run({
        input: {
            stepId: 'await-task-claim',
            updatedTask: result[0]
        }
        
    }).catch((error) => {
        throw error;
    })

    res.status(200).json({ 
        task: result[0],
    })

}
