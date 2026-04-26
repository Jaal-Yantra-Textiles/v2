import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { markOrderFulfillmentAsDeliveredWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerOrderOwnership } from "../../../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderOwnership(req.auth_context, req.params.id, req.scope)

  const { result } = await markOrderFulfillmentAsDeliveredWorkflow(req.scope).run({
    input: {
      orderId: req.params.id,
      fulfillmentId: req.params.fulfillmentId,
    },
  })

  res.json({ order: result })
}
