import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { cancelBeginOrderExchangeWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerOrderEntityOwnership } from "../../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderEntityOwnership(req.auth_context, "exchange", req.params.id, req.scope)

  const { result } = await cancelBeginOrderExchangeWorkflow(req.scope).run({
    input: {
      exchange_id: req.params.id,
    },
  })

  res.json({ exchange: result })
}
