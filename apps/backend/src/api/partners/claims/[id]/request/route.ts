import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { confirmClaimRequestWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerOrderEntityOwnership } from "../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderEntityOwnership(req.auth_context, "claim", req.params.id, req.scope)

  const body = req.body as any
  const { result } = await confirmClaimRequestWorkflow(req.scope).run({
    input: {
      claim_id: req.params.id,
      confirmed_by: req.auth_context.actor_id,
      ...body,
    },
  })

  res.json({ claim: result })
}
