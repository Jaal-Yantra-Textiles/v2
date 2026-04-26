import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { refundPaymentWorkflow } from "@medusajs/medusa/core-flows"
import { getPartnerSalesChannelId } from "../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await getPartnerSalesChannelId(req.auth_context, req.scope)

  const body = req.body as any
  const { result } = await refundPaymentWorkflow(req.scope).run({
    input: {
      payment_id: req.params.id,
      created_by: req.auth_context.actor_id,
      ...body,
    },
  })

  res.json({ payment: result })
}
