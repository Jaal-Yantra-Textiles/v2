/**
 * @file Partner API route for finishing tasks
 * @description Provides endpoints for partners to mark tasks as completed in the JYT Commerce platform
 * @module API/Partners/Tasks
 */

/**
 * @typedef {Object} TaskFinishRequest
 * @property {string} taskId - The ID of the task to be finished
 */

/**
 * @typedef {Object} TaskFinishResponse
 * @property {Object} task - The completed task object
 * @property {string} task.id - The unique identifier of the task
 * @property {string} task.status - The status of the task (completed)
 * @property {Date} task.created_at - When the task was created
 * @property {Date} task.updated_at - When the task was last updated
 * @property {string} task.type - The type of the task
 * @property {Object} task.metadata - Additional metadata associated with the task
 */

/**
 * Finish a task
 * @route POST /partners/tasks/:taskId/finish
 * @group Task - Operations related to tasks
 * @param {string} taskId.path.required - The ID of the task to be finished
 * @returns {TaskFinishResponse} 200 - The completed task object
 * @throws {MedusaError} 400 - Invalid task ID or input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Task not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * POST /partners/tasks/task_123456789/finish
 *
 * @example response 200
 * {
 *   "task": {
 *     "id": "task_123456789",
 *     "status": "completed",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-02T00:00:00Z",
 *     "type": "design",
 *     "metadata": {
 *       "description": "Design a new logo",
 *       "priority": "high"
 *     }
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
    const body = req.body as {
        actual_cost?: number
        cost_type?: "per_unit" | "total"
        cost_currency?: string
        notes?: string
    } | undefined

    const update: Record<string, any> = {
        status: Status.completed,
    }

    // Accept cost data from the partner
    if (body?.actual_cost != null && body.actual_cost > 0) {
        update.actual_cost = body.actual_cost
    }
    if (body?.cost_type) {
        update.cost_type = body.cost_type
    }
    if (body?.cost_currency) {
        update.cost_currency = body.cost_currency
    }

    const { result, errors } = await updateTaskWorkflow(req.scope).run({
        input: {
            id: taskId,
            update,
        }
    })

    if (errors && errors.length > 0) {
        console.warn("Error reported at", errors);
        throw errors;
    }

    // Signal the workflow step only if the task has a transaction_id
    // (meaning it was created as part of a long-running workflow)
    const updatedTask = result[0]
    if (updatedTask?.transaction_id) {
        await setStepSuccessWorkflow(req.scope).run({
            input: {
                stepId: 'await-task-finish',
                updatedTask,
            }
        }).catch(() => {
            // Expected if the workflow already completed or was cancelled
        })
    }

    res.status(200).json({
        task: result[0],
    })

}
