import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createOrderShipmentWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerOrderOwnership } from "../../../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderOwnership(req.auth_context, req.params.id, req.scope)

  const body = req.body as any
  const { result } = await createOrderShipmentWorkflow(req.scope).run({
    input: {
      order_id: req.params.id,
      fulfillment_id: req.params.fulfillmentId,
      items: body.items,
      labels: body.labels,
      no_notification: body.no_notification,
      metadata: body.metadata,
      additional_data: body.additional_data,
    },
  })

  res.json({ order: result })
}
