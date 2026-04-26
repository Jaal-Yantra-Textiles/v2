import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { validatePartnerOrderOwnership } from "../../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderOwnership(req.auth_context, req.params.id, req.scope)

  const orderService = req.scope.resolve(Modules.ORDER) as any
  const change = await orderService.updateOrderChanges(req.params.changeId, req.body as any)

  res.json({ order_change: change })
}
