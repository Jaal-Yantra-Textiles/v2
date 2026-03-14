import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { orderExchangeRequestItemReturnWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerOrderEntityOwnership } from "../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderEntityOwnership(req.auth_context, "exchange", req.params.id, req.scope)

  const body = req.body as any
  const { result } = await orderExchangeRequestItemReturnWorkflow(req.scope).run({
    input: {
      exchange_id: req.params.id,
      ...body,
    },
  })

  res.json({ order_preview: result })
}
