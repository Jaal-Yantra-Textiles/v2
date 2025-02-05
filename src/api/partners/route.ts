import { 
    AuthenticatedMedusaRequest, 
    MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import createPartnerAdminWorkflow from "../../workflows/partner/create-partner-admin"
import { partnerSchema } from "./validators"
import type { z } from "zod"
import { refetchPartner } from "./helpers"

type RequestBody = z.infer<typeof partnerSchema>

export const POST = async (
    req: AuthenticatedMedusaRequest<RequestBody>,
    res: MedusaResponse
) => {
    // If actor_id is present, the request carries 
    // authentication for an existing partner admin
    if (req.auth_context?.actor_id) {
        throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            "Request already authenticated as a partner."
        )
    }

    const { admin, ...partnerData } = partnerSchema.parse(req.body)

    // Create partner and admin using workflow
    const { result } = await createPartnerAdminWorkflow(req.scope)
        .run({
            input: {
                partner: partnerData,
                admin,
                authIdentityId: req.auth_context.auth_identity_id,
            },
        })

    // Refetch partner with admin details
    const partnerWithAdmin = await refetchPartner(result.partner.id, req.scope)

    res.json({
        partner: partnerWithAdmin,
    })
}



