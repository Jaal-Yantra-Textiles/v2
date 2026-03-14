import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { cancelOrderExchangeWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerOrderEntityOwnership } from "../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderEntityOwnership(req.auth_context, "exchange", req.params.id, req.scope)

  const { result } = await cancelOrderExchangeWorkflow(req.scope).run({
    input: {
      exchange_id: req.params.id,
      canceled_by: req.auth_context.actor_id,
    },
  })

  res.json({ exchange: result })
}
