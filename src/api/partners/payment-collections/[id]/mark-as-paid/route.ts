import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { markPaymentCollectionAsPaid } from "@medusajs/medusa/core-flows"
import { getPartnerSalesChannelId } from "../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await getPartnerSalesChannelId(req.auth_context, req.scope)

  const body = req.body as any
  const { result } = await markPaymentCollectionAsPaid(req.scope).run({
    input: {
      payment_collection_id: req.params.id,
      captured_by: req.auth_context.actor_id,
      ...body,
    },
  })

  res.json({ payment_collection: result })
}
