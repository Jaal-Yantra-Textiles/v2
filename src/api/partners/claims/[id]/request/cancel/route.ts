import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { cancelBeginOrderClaimWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerOrderEntityOwnership } from "../../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderEntityOwnership(req.auth_context, "claim", req.params.id, req.scope)

  const { result } = await cancelBeginOrderClaimWorkflow(req.scope).run({
    input: {
      claim_id: req.params.id,
    },
  })

  res.json({ claim: result })
}
