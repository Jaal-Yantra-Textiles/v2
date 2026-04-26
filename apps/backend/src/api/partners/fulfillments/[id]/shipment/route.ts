import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createShipmentWorkflow } from "@medusajs/medusa/core-flows"
import { getPartnerSalesChannelId } from "../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await getPartnerSalesChannelId(req.auth_context, req.scope)

  const body = req.body as any
  const { result } = await createShipmentWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      ...body,
    },
  })

  res.json({ fulfillment: result })
}
