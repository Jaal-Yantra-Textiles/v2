import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { validatePartnerOrderOwnership } from "../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderOwnership(req.auth_context, req.params.id, req.scope)

  const orderService = req.scope.resolve(Modules.ORDER) as any
  const body = req.body as any
  const creditLine = await orderService.createOrderCreditLines({
    order_id: req.params.id,
    ...body,
  })

  res.json({ order: { id: req.params.id, credit_line: creditLine } })
}
