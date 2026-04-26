import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createOrderFulfillmentWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerOrderOwnership } from "../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderOwnership(req.auth_context, req.params.id, req.scope)

  const body = req.body as any
  const { result } = await createOrderFulfillmentWorkflow(req.scope).run({
    input: {
      order_id: req.params.id,
      items: body.items,
      no_notification: body.no_notification,
      location_id: body.location_id,
      metadata: body.metadata,
      additional_data: body.additional_data,
    },
  })

  res.json({ order: result })
}
