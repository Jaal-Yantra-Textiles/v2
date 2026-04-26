import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { updateExchangeShippingMethodWorkflow, removeExchangeShippingMethodWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerOrderEntityOwnership } from "../../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderEntityOwnership(req.auth_context, "exchange", req.params.id, req.scope)

  const body = req.body as any
  const { result } = await updateExchangeShippingMethodWorkflow(req.scope).run({
    input: {
      exchange_id: req.params.id,
      action_id: req.params.actionId,
      data: body,
    },
  })

  res.json({ order_preview: result })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderEntityOwnership(req.auth_context, "exchange", req.params.id, req.scope)

  const { result } = await removeExchangeShippingMethodWorkflow(req.scope).run({
    input: {
      exchange_id: req.params.id,
      action_id: req.params.actionId,
    },
  })

  res.json({ order_preview: result })
}
