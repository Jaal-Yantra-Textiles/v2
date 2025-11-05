import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { updateTaskWorkflow } from "../../../../../workflows/tasks/update-task";
import { setStepSuccessWorkflow } from "../../../../../workflows/tasks/task-engine/task-steps";
import { Status } from "../../../../../workflows/tasks/create-task";
import PartnerTaskLink from "../../../../../links/partner-task";
import { getPartnerFromActorId } from "../../../helpers";
import { TASKS_MODULE } from "../../../../../modules/tasks";
import TaskService from "../../../../../modules/tasks/service";

/**
 * POST /partners/assigned-tasks/[taskId]/finish
 * Partner completes a standalone task
 * Partner can submit the bill alongside, either pre-agreed or through the task form
 */
export async function POST(
    req: AuthenticatedMedusaRequest,
    res: MedusaResponse
) {
    const taskId = req.params.taskId;
    const actorId = req.auth_context?.actor_id;
    
    if (!actorId) {
        return res.status(401).json({ 
            message: "Partner authentication required" 
        });
    }

    try {
        // Fetch the partner using the helper that handles both auth flows
        const partner = await getPartnerFromActorId(actorId, req.scope);
        
        if (!partner) {
            throw new MedusaError(
                MedusaError.Types.UNAUTHORIZED, 
                "No partner associated with this admin"
            );
        }

        console.log("Finish task - Partner ID:", partner.id, "Actor ID:", actorId, "Task ID:", taskId);

        // Verify the task is assigned to this partner
        const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
        const { data: taskData } = await query.index({
            entity: 'task',
            fields: ["*","partners.*"],
            filters: {
               partners: {id: partner.id},
               id: taskId
            }
        });

        if (!taskData || taskData.length === 0) {
            return res.status(403).json({ 
                message: "Task not assigned to this partner or does not exist" 
            });
        }

        const task = taskData[0];

        // Get existing metadata and update all steps to completed
        const metadata = ((task as any).metadata || {}) as Record<string, any>;
        const workflowConfig = metadata.workflow_config || {};
        const steps = workflowConfig.steps || [];

        // Mark all steps as completed
        if (steps.length > 0) {
            const updatedSteps = steps.map((step: any) => ({
                ...step,
                status: "completed"
            }));

            workflowConfig.steps = updatedSteps;
            metadata.workflow_config = workflowConfig;

            console.log(`Marking ${steps.length} steps as completed`);
        }

        // Update task status to completed and update steps
        const taskService = req.scope.resolve<TaskService>(TASKS_MODULE);
        await taskService.updateTasks({
            id: taskId,
            status: "completed" as any,
            metadata: metadata,
            completed_at: new Date()
        });

        // Fetch updated task
        const { result, errors } = await updateTaskWorkflow(req.scope).run({
            input: {
                id: taskId,
                update: {
                    status: Status.completed
                }
            }
        });

        if (errors && errors.length > 0) {
            console.warn("Error updating task:", errors);
            throw errors;
        }

        /**
         * Signal the workflow step for task completion
         * This will only succeed if there's an active workflow waiting
         * If no workflow exists, it will fail silently (caught error)
         */
        await setStepSuccessWorkflow(req.scope).run({
            input: {
                stepId: 'await-task-finish',
                updatedTask: result[0]
            }
        }).catch((error) => {
            console.log("No active workflow to signal (this is OK for standalone tasks):", error.message);
            // Don't throw - task is already updated
            // This is expected for standalone tasks without workflows
        });

        res.status(200).json({ 
            task: result[0],
            message: "Task completed successfully"
        });

    } catch (error) {
        console.error("Error completing task:", error);
        res.status(500).json({ 
            message: "Failed to complete task",
            error: error instanceof Error ? error.message : String(error)
        });
    }
}
