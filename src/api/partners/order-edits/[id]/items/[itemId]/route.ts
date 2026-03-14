import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { orderEditUpdateItemQuantityWorkflow, removeItemOrderEditActionWorkflow } from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { validatePartnerOrderOwnership } from "../../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
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

  const body = req.body as any
  const { result } = await orderEditUpdateItemQuantityWorkflow(req.scope).run({
    input: {
      order_id: orderChange?.order_id || req.params.id,
      item_id: req.params.itemId,
      ...body,
    },
  })

  res.json({ order_preview: result })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
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

  const { result } = await removeItemOrderEditActionWorkflow(req.scope).run({
    input: {
      order_id: orderChange?.order_id || req.params.id,
      action_id: req.params.itemId,
    },
  })

  res.json({ order_preview: result })
}
