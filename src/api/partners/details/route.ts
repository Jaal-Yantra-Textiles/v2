import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { refetchPartnerForThisAdmin } from "../helpers"

export const GET = async (
    req: AuthenticatedMedusaRequest,
    res: MedusaResponse
) => {
    
    const adminId = req.auth_context.actor_id

    const partnerAdmin = await refetchPartnerForThisAdmin(
        adminId, req.scope
    )
    
    res.json({
        partner: partnerAdmin
    })
}