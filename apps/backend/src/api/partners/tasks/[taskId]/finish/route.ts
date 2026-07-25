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
import { finishPartnerTaskWorkflow } from "../../../../../workflows/tasks/finish-partner-task";

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

    // finishPartnerTaskWorkflow marks the task completed (with cost data),
    // cascades completion to any open subtasks, and signals the
    // await-task-finish gate when the task has a transaction_id.
    const { result, errors } = await finishPartnerTaskWorkflow(req.scope).run({
        input: {
            task_id: taskId,
            cost: {
                actual_cost: body?.actual_cost,
                cost_type: body?.cost_type,
                cost_currency: body?.cost_currency,
            },
        }
    })

    if (errors && errors.length > 0) {
        throw errors;
    }

    const tasks = result?.tasks
    const updatedTask = Array.isArray(tasks) ? tasks[0] : tasks

    res.status(200).json({
        task: updatedTask,
    })

}
