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
