import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createFulfillmentWorkflow } from "@medusajs/medusa/core-flows"
import { getPartnerSalesChannelId } from "../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await getPartnerSalesChannelId(req.auth_context, req.scope)

  const body = req.body as any
  const { result } = await createFulfillmentWorkflow(req.scope).run({
    input: body,
  })

  res.json({ fulfillment: result })
}
