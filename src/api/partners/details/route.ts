import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { getPartnerFromActorId } from "../helpers"

export const GET = async (
    req: AuthenticatedMedusaRequest,
    res: MedusaResponse
) => {
    const actorId = req.auth_context?.actor_id
    
    if (!actorId) {
        return res.status(401).json({
            error: "Partner authentication required - no actor ID"
        })
    }
    
    const partner = await getPartnerFromActorId(actorId, req.scope)
    
    if (!partner) {
        return res.status(401).json({
            error: "Partner authentication required - no partner found"
        })
    }
    
    res.json({
        partner: partner
    })
}