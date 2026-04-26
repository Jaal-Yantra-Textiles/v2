import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { getPartnerSalesChannelId } from "../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await getPartnerSalesChannelId(req.auth_context, req.scope)

  const paymentService = req.scope.resolve(Modules.PAYMENT) as any
  const body = req.body as any
  const paymentCollection = await paymentService.createPaymentCollections(body)

  res.json({ payment_collection: paymentCollection })
}
