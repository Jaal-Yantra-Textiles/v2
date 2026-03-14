import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { confirmExchangeRequestWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerOrderEntityOwnership } from "../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderEntityOwnership(req.auth_context, "exchange", req.params.id, req.scope)

  const body = req.body as any
  const { result } = await confirmExchangeRequestWorkflow(req.scope).run({
    input: {
      exchange_id: req.params.id,
      confirmed_by: req.auth_context.actor_id,
      ...body,
    },
  })

  res.json({ exchange: result })
}
