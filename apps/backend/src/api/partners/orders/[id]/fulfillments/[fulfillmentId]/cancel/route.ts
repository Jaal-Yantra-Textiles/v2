import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { cancelOrderFulfillmentWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerOrderOwnership } from "../../../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderOwnership(req.auth_context, req.params.id, req.scope)

  const body = req.body as any
  await cancelOrderFulfillmentWorkflow(req.scope).run({
    input: {
      order_id: req.params.id,
      fulfillment_id: req.params.fulfillmentId,
      no_notification: body?.no_notification,
    },
  })

  res.json({ order: { id: req.params.id } })
}
