import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { updateTaskWorkflow } from "../../../../../workflows/tasks/update-task";
import { setStepSuccessWorkflow } from "../../../../../workflows/tasks/task-engine/task-steps";
import { Status } from "../../../../../workflows/tasks/create-task";
import PartnerTaskLink from "../../../../../links/partner-task";
import { getPartnerFromActorId } from "../../../helpers";

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
        const partner = await getPartnerFromActorId(actorId, req.scope);
        
        if (!partner) {
            throw new MedusaError(
                MedusaError.Types.UNAUTHORIZED, 
                "No partner associated with this admin"
            );
        }

        console.log("Accept task - Partner ID:", partner.id, "Actor ID:", actorId, "Task ID:", taskId);
        
        // Verify the task is assigned to this partner
        const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
        const { data: partnerTaskLinks } = await query.index({
            entity: 'task',
            fields: ["*","partners.*"],
            filters: {
               partners: { id: partner.id },
               id: taskId
            }
        });
        console.log("Partner task links found:", partnerTaskLinks?.length || 0);
        console.log("Partner task links data:", JSON.stringify(partnerTaskLinks, null, 2));
        
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
         * This will only succeed if there's an active workflow waiting
         * If no workflow exists, it will fail silently (caught error)
         */
        await setStepSuccessWorkflow(req.scope).run({
            input: {
                stepId: 'await-task-claim',
                updatedTask: result[0]
            }
        }).catch((error) => {
            console.log("No active workflow to signal (this is OK for standalone tasks):", error.message);
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
