import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import PartnerTaskLink from "../../../links/partner-task";

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
    
    // Get partner ID from authenticated user
    const partnerId = req.auth_context?.actor_id;
    
    if (!partnerId) {
        return res.status(401).json({ 
            message: "Partner authentication required" 
        });
    }

    try {
        console.log("Fetching tasks for partner:", partnerId);
        
        // Query all tasks linked to this partner
        const { data: partnerData } = await query.index({
            entity: 'partner',
            fields: [ 'tasks.*'],
            filters: {
                id: partnerId    
            }
        });

        console.log("Partner data:", JSON.stringify(partnerData, null, 2));

        // Extract the tasks from the partner object
        const tasks = partnerData && partnerData.length > 0 && partnerData[0].tasks 
            ? partnerData[0].tasks 
            : [];

        console.log("Extracted tasks:", tasks.length);

        res.status(200).json({ 
            tasks: tasks,
            count: tasks.length
        });
    } catch (error) {
        console.error("Error fetching assigned tasks:", error);
        res.status(500).json({ 
            message: "Failed to fetch assigned tasks",
            error: error instanceof Error ? error.message : String(error)
        });
    }
}
