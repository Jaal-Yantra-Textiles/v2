import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { cancelFulfillmentWorkflow } from "@medusajs/medusa/core-flows"
import { getPartnerSalesChannelId } from "../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await getPartnerSalesChannelId(req.auth_context, req.scope)

  const { result } = await cancelFulfillmentWorkflow(req.scope).run({
    input: { id: req.params.id },
  })

  res.json({ fulfillment: result })
}
