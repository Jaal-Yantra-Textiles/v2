import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import PartnerTaskLink from "../../../links/partner-task";
import { getPartnerFromActorId } from "../helpers";

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

        console.log("Fetching tasks for partner:", partner.id, "via actor:", actorId);
        
        // Query all tasks linked to this partner
        const { data: partnerData } = await query.index({
            entity: 'partner',
            fields: [ '*','tasks.*'],
            filters: {
                id: partner.id
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
