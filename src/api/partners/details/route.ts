import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { getPartnerFromAuthContext } from "../helpers"

export const GET = async (
    req: AuthenticatedMedusaRequest,
    res: MedusaResponse
) => {
    if (!req.auth_context?.actor_id) {
        return res.status(401).json({
            error: "Partner authentication required - no actor ID"
        })
    }
    
    const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
    
    if (!partner) {
        return res.status(401).json({
            error: "Partner authentication required - no partner found"
        })
    }
    
    res.json({
        partner: partner
    })
}