import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import PartnerTaskLink from "../../../links/partner-task";
import { getPartnerFromActorId } from "../helpers";
import { TASKS_MODULE } from "../../../modules/tasks";
import TaskService from "../../../modules/tasks/service";

/**
 * GET /partners/assigned-tasks
 * Lists all standalone tasks assigned to the authenticated partner
 * These are tasks assigned directly to the partner (not through designs or other entities)
 */
export async function GET(
    req: AuthenticatedMedusaRequest,
    res: MedusaResponse
) {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
    
    // Get actor ID from authenticated user (can be partner ID or admin ID)
    const actorId = req.auth_context?.actor_id;
    
    if (!actorId) {
        return res.status(401).json({ 
            message: "Partner authentication required - no actor ID" 
        });
    }

    try {
        // Fetch the partner using the helper that handles both auth flows
        const partner = await getPartnerFromActorId(actorId, req.scope);
        
        if (!partner) {
            throw new MedusaError(
                MedusaError.Types.UNAUTHORIZED, 
                "No partner found for this user"
            );
        }

        // Query all tasks linked to this partner
        const { data: partnerData } = await query.graph({
            entity: 'partner',
            fields: [ '*','tasks.*'],
            filters: {
                id: partner.id
            }
        });

        // Extract the tasks from the partner object
        let allTaskIds: any[] = [];
        if (partnerData && partnerData.length > 0) {
            const partner = partnerData[0];
            if (Array.isArray(partner.tasks)) {
                allTaskIds = partner.tasks.map((t: any) => t.id);
            }
        }

        if (allTaskIds.length === 0) {
            return res.status(200).json({ 
                tasks: [],
                count: 0
            });
        }

        // Now fetch the tasks with their subtasks using the task service
        const taskService: TaskService = req.scope.resolve(TASKS_MODULE);
        
        const allTasks = await taskService.listTasks(
            { id: allTaskIds },
            { relations: ["subtasks"] }
        );

        // Filter to only show parent tasks (exclude subtasks)
        // Subtasks have parent_task_id set, parent tasks have it as null
        const parentTasks = allTasks.filter((task: any) => !task.parent_task_id);

        res.status(200).json({ 
            tasks: parentTasks,
            count: parentTasks.length
        });
    } catch (error) {
        console.error("Error fetching assigned tasks:", error);
        res.status(500).json({ 
            message: "Failed to fetch assigned tasks",
            error: error instanceof Error ? error.message : String(error)
        });
    }
}
