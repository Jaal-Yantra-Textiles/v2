import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { capturePaymentWorkflow } from "@medusajs/medusa/core-flows"
import { getPartnerSalesChannelId } from "../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await getPartnerSalesChannelId(req.auth_context, req.scope)

  const body = req.body as any
  const { result } = await capturePaymentWorkflow(req.scope).run({
    input: {
      payment_id: req.params.id,
      captured_by: req.auth_context.actor_id,
      amount: body.amount,
    },
  })

  res.json({ payment: result })
}
