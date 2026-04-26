/**
 * @file Admin API route for assigning tasks to partners
 * @description Provides endpoints for assigning specific tasks to partners in the JYT Commerce platform
 * @module API/Admin/Partners/Tasks
 */

/**
 * @typedef {Object} AdminPostPartnerTaskAssignReq
 * @property {string} [additional_data] - Optional additional data to include with the task assignment
 */

/**
 * @typedef {Object} Partner
 * @property {string} id - The unique identifier of the partner
 * @property {string} name - The name of the partner
 * @property {string} email - The email address of the partner
 * @property {string} status - The current status of the partner (active/inactive)
 */

/**
 * @typedef {Object} Task
 * @property {string} id - The unique identifier of the task
 * @property {string} title - The title of the task
 * @property {string} description - The description of the task
 * @property {string} status - The current status of the task (pending, assigned, completed, etc.)
 * @property {Date} created_at - When the task was created
 * @property {Date} updated_at - When the task was last updated
 * @property {Partner[]} partners - Array of partners assigned to this task
 */

/**
 * @typedef {Object} TaskAssignmentResponse
 * @property {Task} task - The task object with updated partner assignments
 */

/**
 * Assign a task to a partner
 * @route POST /admin/partners/:id/tasks/:taskId/assign
 * @group Partner Tasks - Operations related to partner task assignments
 * @param {string} id.path.required - The ID of the partner to assign the task to
 * @param {string} taskId.path.required - The ID of the task to be assigned
 * @param {AdminPostPartnerTaskAssignReq} request.body - Optional additional data for the assignment
 * @returns {TaskAssignmentResponse} 200 - Task object with updated partner assignments
 * @throws {MedusaError} 400 - Invalid input data or missing required fields
 * @throws {MedusaError} 401 - Unauthorized access
 * @throws {MedusaError} 404 - Partner or task not found
 * @throws {MedusaError} 500 - Internal server error during task assignment workflow
 *
 * @example request
 * POST /admin/partners/partner_123/tasks/task_456/assign
 * {
 *   "additional_data": "Urgent priority assignment"
 * }
 *
 * @example response 200
 * {
 *   "task": {
 *     "id": "task_456",
 *     "title": "Website Redesign",
 *     "description": "Complete redesign of the main website",
 *     "status": "assigned",
 *     "created_at": "2023-01-15T09:30:00Z",
 *     "updated_at": "2023-01-20T14:45:00Z",
 *     "partners": [
 *       {
 *         "id": "partner_123",
 *         "name": "Design Studio Inc.",
 *         "email": "contact@designstudio.com",
 *         "status": "active"
 *       }
 *     ]
 *   }
 * }
 */
import { MedusaRequest, MedusaResponse, refetchEntity } from "@medusajs/framework";
import { createTaskAssignmentWorkflow } from "../../../../../../../workflows/tasks/create-task-assignment";
import { runTaskAssignmentWorkflow } from "../../../../../../../workflows/tasks/run-task-assignment";
import { setStepSuccessWorkflow } from "../../../../../../../workflows/tasks/task-engine/task-steps";
import { AdminPostPartnerTaskAssignReq } from "./validators";


/**
 * POST /admin/partners/[id]/tasks/[taskId]/assign
 * Admin assigns a task to a partner
 * Mimics the design task assignment workflow
 */
export const POST = async (req: MedusaRequest<AdminPostPartnerTaskAssignReq>, res: MedusaResponse) => {
    const partnerId = req.params.id;
    const taskId = req.params.taskId;

    // Create the partner-task link
    await createTaskAssignmentWorkflow(req.scope).run({
        input: {
            taskId: taskId,
            partnerId: partnerId
        }
    });

    // Refetch the task with partner data
    const task = await refetchEntity({
        entity: "task",
        idOrFilter: taskId,
        scope: req.scope,
        fields: ["*", 'partners.*']
    });

    // Run the assignment workflow (notify partner, await acceptance, await completion)
    const { transaction } = await runTaskAssignmentWorkflow(req.scope).run({
        input: {
            input: {
                taskId: taskId,
                partnerId: partnerId
            },
            task: task
        }
    });

    const postTaskTransactionId = {
        transaction_id: transaction.transactionId
    };

    /**
     * Signal that the partner has been notified
     */
    await setStepSuccessWorkflow(req.scope).run({
        input: {
            stepId: 'notify-partner',
            updatedTask: postTaskTransactionId
        }
    }).catch((error) => {
        throw error;
    });

    return res.json({
        task
    });
}
