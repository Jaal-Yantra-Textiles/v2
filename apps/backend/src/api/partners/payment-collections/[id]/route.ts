import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { getPartnerSalesChannelId } from "../../helpers"

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await getPartnerSalesChannelId(req.auth_context, req.scope)

  const paymentService = req.scope.resolve(Modules.PAYMENT) as any
  await paymentService.deletePaymentCollections(req.params.id)

  res.json({ id: req.params.id, object: "payment-collection", deleted: true })
}
