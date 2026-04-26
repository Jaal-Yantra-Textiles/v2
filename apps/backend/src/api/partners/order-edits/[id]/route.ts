import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { cancelBeginOrderEditWorkflow } from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { validatePartnerOrderOwnership } from "../../helpers"

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  // Look up the order edit to find its order_id
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order_change",
    fields: ["id", "order_id"],
    filters: { id: req.params.id },
  })
  const orderChange = data?.[0] as any
  if (orderChange?.order_id) {
    await validatePartnerOrderOwnership(req.auth_context, orderChange.order_id, req.scope)
  }

  const { result } = await cancelBeginOrderEditWorkflow(req.scope).run({
    input: {
      order_id: orderChange?.order_id || req.params.id,
    },
  })

  res.json({ id: req.params.id, object: "order-edit", deleted: true })
}
