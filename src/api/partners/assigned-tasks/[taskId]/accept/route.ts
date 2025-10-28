import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { updateTaskWorkflow } from "../../../../../workflows/tasks/update-task";
import { setStepSuccessWorkflow } from "../../../../../workflows/tasks/task-engine/task-steps";
import { Status } from "../../../../../workflows/tasks/create-task";
import PartnerTaskLink from "../../../../../links/partner-task";

/**
 * POST /partners/assigned-tasks/[taskId]/accept
 * Partner accepts a standalone task assignment
 */
export async function POST(
    req: AuthenticatedMedusaRequest,
    res: MedusaResponse
) {
    const taskId = req.params.taskId;
    const partnerId = req.auth_context?.actor_id;
    
    if (!partnerId) {
        return res.status(401).json({ 
            message: "Partner authentication required" 
        });
    }

    try {
        // Verify the task is assigned to this partner
        const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
        const { data: partnerTaskLinks } = await query.index({
            entity: 'task',
            fields: ["partner.*"],
            filters: {
               partner_id: partnerId,
               id: taskId
            }
        });

        if (!partnerTaskLinks || partnerTaskLinks.length === 0) {
            return res.status(403).json({ 
                message: "Task not assigned to this partner or does not exist" 
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
         */
        await setStepSuccessWorkflow(req.scope).run({
            input: {
                stepId: 'await-task-claim',
                updatedTask: result[0]
            }
        }).catch((error) => {
            console.error("Error signaling workflow step:", error);
            // Don't throw - task is already updated
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
