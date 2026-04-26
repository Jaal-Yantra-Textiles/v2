import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { validatePartnerOrderOwnership } from "../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  // Look up the order change to find its order_id
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order_change",
    fields: ["id", "order_id"],
    filters: { id: req.params.orderChangeId },
  })

  const orderChange = data?.[0] as any
  if (orderChange?.order_id) {
    await validatePartnerOrderOwnership(req.auth_context, orderChange.order_id, req.scope)
  }

  const orderService = req.scope.resolve(Modules.ORDER) as any
  const change = await orderService.updateOrderChanges(req.params.orderChangeId, req.body as any)

  res.json({ order_change: change })
}
