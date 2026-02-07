/**
 * @file Admin API routes for managing partner tasks
 * @description Provides endpoints for listing and creating tasks assigned to partners in the JYT Commerce platform
 * @module API/Admin/Partners/Tasks
 */

/**
 * @typedef {Object} AdminCreatePartnerTaskReq
 * @property {string} title.required - The title of the task
 * @property {string} description - The description of the task
 * @property {string} status - The status of the task (e.g., "pending", "in_progress", "completed")
 * @property {string} priority - The priority level of the task (e.g., "low", "medium", "high")
 * @property {Date|string} end_date - The due date for the task (ISO format or Date object)
 * @property {Date|string} start_date - The start date for the task (ISO format or Date object)
 * @property {string[]} template_names - Names of templates associated with the task
 * @property {Object} eventable - Eventable configuration for the task
 * @property {Object} notifiable - Notifiable configuration for the task
 * @property {string} message - Additional message for the task
 * @property {Object} metadata - Additional metadata for the task
 * @property {Object[]} child_tasks - Array of child tasks
 * @property {string} child_tasks.title - Title of the child task
 * @property {string} child_tasks.description - Description of the child task
 * @property {Date|string} child_tasks.start_date - Start date for the child task
 * @property {Date|string} child_tasks.end_date - End date for the child task
 * @property {string} dependency_type - Type of dependency for the task
 */

/**
 * @typedef {Object} TaskResponse
 * @property {string} id - The unique identifier of the task
 * @property {string} title - The title of the task
 * @property {string} description - The description of the task
 * @property {string} status - The status of the task
 * @property {string} priority - The priority level of the task
 * @property {Date} end_date - The due date for the task
 * @property {Date} start_date - The start date for the task
 * @property {string[]} template_names - Names of templates associated with the task
 * @property {Object} eventable - Eventable configuration for the task
 * @property {Object} notifiable - Notifiable configuration for the task
 * @property {string} message - Additional message for the task
 * @property {Object} metadata - Additional metadata for the task
 * @property {Object[]} child_tasks - Array of child tasks
 * @property {string} dependency_type - Type of dependency for the task
 */

/**
 * @typedef {Object} PartnerTasksResponse
 * @property {TaskResponse[]} tasks - Array of tasks assigned to the partner
 * @property {number} count - Total count of tasks
 */

/**
 * List all tasks assigned to a specific partner
 * @route GET /admin/partners/:id/tasks
 * @group Partner Tasks - Operations related to partner tasks
 * @param {string} id.path.required - The ID of the partner
 * @returns {PartnerTasksResponse} 200 - List of tasks assigned to the partner
 * @throws {MedusaError} 404 - Partner not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * GET /admin/partners/partner_123/tasks
 *
 * @example response 200
 * {
 *   "tasks": [
 *     {
 *       "id": "task_123",
 *       "title": "Complete Onboarding",
 *       "description": "Complete the onboarding process for the new partner",
 *       "status": "in_progress",
 *       "priority": "high",
 *       "start_date": "2023-01-01T00:00:00Z",
 *       "end_date": "2023-01-31T00:00:00Z",
 *       "template_names": ["onboarding_template"],
 *       "eventable": {},
 *       "notifiable": {},
 *       "message": "Please complete the onboarding process",
 *       "metadata": {},
 *       "child_tasks": [],
 *       "dependency_type": "none"
 *     }
 *   ],
 *   "count": 1
 * }
 */

/**
 * Create a new task and assign it to a partner
 * @route POST /admin/partners/:id/tasks
 * @group Partner Tasks - Operations related to partner tasks
 * @param {string} id.path.required - The ID of the partner
 * @param {AdminCreatePartnerTaskReq} request.body.required - Task data to create
 * @returns {TaskResponse} 200 - Created task object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Partner not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * POST /admin/partners/partner_123/tasks
 * {
 *   "title": "Complete Onboarding",
 *   "description": "Complete the onboarding process for the new partner",
 *   "status": "pending",
 *   "priority": "high",
 *   "end_date": "2023-01-31T00:00:00Z",
 *   "start_date": "2023-01-01T00:00:00Z",
 *   "template_names": ["onboarding_template"],
 *   "eventable": {},
 *   "notifiable": {},
 *   "message": "Please complete the onboarding process",
 *   "metadata": {},
 *   "child_tasks": [],
 *   "dependency_type": "none"
 * }
 *
 * @example response 200
 * {
 *   "task": {
 *     "id": "task_123",
 *     "title": "Complete Onboarding",
 *     "description": "Complete the onboarding process for the new partner",
 *     "status": "pending",
 *     "priority": "high",
 *     "start_date": "2023-01-01T00:00:00Z",
 *     "end_date": "2023-01-31T00:00:00Z",
 *     "template_names": ["onboarding_template"],
 *     "eventable": {},
 *     "notifiable": {},
 *     "message": "Please complete the onboarding process",
 *     "metadata": {},
 *     "child_tasks": [],
 *     "dependency_type": "none"
 *   }
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import PartnerTaskLink from "../../../../../links/partner-task";
import { createTaskWorkflow } from "../../../../../workflows/tasks/create-task";
import { createTaskAssignmentWorkflow } from "../../../../../workflows/tasks/create-task-assignment";
import { AdminCreatePartnerTaskReq } from "./validators";


/**
 * GET /admin/partners/[id]/tasks
 * Lists all tasks assigned to a specific partner
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
    const partnerId = req.params.id;
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

    try {
        // Query all tasks linked to this partner
        const { data: partnerData } = await query.index({
            entity: 'partner',
            fields: [ 'tasks.*'],
            filters: {
                id: partnerId    
            }
        });

        // Extract the tasks from the partner object
        const tasks = partnerData && partnerData.length > 0 && partnerData[0].tasks 
            ? partnerData[0].tasks 
            : [];

        return res.json({ 
            tasks: tasks,
            count: tasks.length
        });
    } catch (error) {
        console.error("Error fetching partner tasks:", error);
        return res.status(500).json({ 
            message: "Failed to fetch partner tasks",
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * POST /admin/partners/[id]/tasks
 * Creates a new task and assigns it to the partner
 */
export const POST = async (req: MedusaRequest<AdminCreatePartnerTaskReq>, res: MedusaResponse) => {
    const partnerId = req.params.id;

    try {
        // Create the task (without assignee_id since we'll link it separately)
        const { result } = await createTaskWorkflow(req.scope).run({
            input: {
                title: req.validatedBody.title,
                description: req.validatedBody.description,
                status: req.validatedBody.status,
                priority: req.validatedBody.priority,
                end_date: req.validatedBody.end_date 
                    ? (typeof req.validatedBody.end_date === 'string' 
                        ? new Date(req.validatedBody.end_date) 
                        : req.validatedBody.end_date)
                    : undefined,
                start_date: req.validatedBody.start_date 
                    ? (typeof req.validatedBody.start_date === 'string' 
                        ? new Date(req.validatedBody.start_date) 
                        : req.validatedBody.start_date)
                    : new Date(), // Default to today if not provided
                template_names: req.validatedBody.template_names,
                eventable: req.validatedBody.eventable,
                notifiable: req.validatedBody.notifiable,
                message: req.validatedBody.message,
                metadata: req.validatedBody.metadata,
                child_tasks: req.validatedBody.child_tasks?.map((childTask: any) => ({
                    ...childTask,
                    start_date: childTask.start_date 
                        ? (typeof childTask.start_date === 'string' 
                            ? new Date(childTask.start_date) 
                            : childTask.start_date)
                        : new Date(), // Default to today if not provided
                    end_date: childTask.end_date 
                        ? (typeof childTask.end_date === 'string' 
                            ? new Date(childTask.end_date) 
                            : childTask.end_date)
                        : undefined,
                })),
                dependency_type: req.validatedBody.dependency_type,
            }
        });

        // Extract the created task from the workflow result
        const task = result.withoutTemplates || result.withTemplates || result.withParent;

        if (!task) {
            throw new MedusaError(
                MedusaError.Types.INVALID_DATA,
                "Failed to create task"
            );
        }

        // Get the task ID based on the result structure
        let taskId: string;
        if (Array.isArray(task)) {
            // Simple task array
            taskId = task[0]?.id;
        } else if ('parent' in task && task.parent) {
            // Parent-child structure - use parent task ID
            taskId = task.parent.id;
        } else if ('id' in task) {
            // Single task object
            taskId = task.id;
        } else {
            throw new MedusaError(
                MedusaError.Types.INVALID_DATA,
                "Unable to extract task ID from workflow result"
            );
        }

        // Create the partner-task link
        await createTaskAssignmentWorkflow(req.scope).run({
            input: {
                taskId: taskId,
                partnerId: partnerId
            }
        });

        return res.json({ 
            task: task
        });
    } catch (error) {
        console.error("Error creating partner task:", error);
        return res.status(500).json({ 
            message: "Failed to create partner task",
            error: error instanceof Error ? error.message : String(error)
        });
    }
};
