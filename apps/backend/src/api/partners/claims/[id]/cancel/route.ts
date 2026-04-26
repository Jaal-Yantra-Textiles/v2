import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { cancelOrderClaimWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerOrderEntityOwnership } from "../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderEntityOwnership(req.auth_context, "claim", req.params.id, req.scope)

  const { result } = await cancelOrderClaimWorkflow(req.scope).run({
    input: {
      claim_id: req.params.id,
      canceled_by: req.auth_context.actor_id,
    },
  })

  res.json({ claim: result })
}
