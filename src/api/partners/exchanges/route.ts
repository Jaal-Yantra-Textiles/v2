import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { beginExchangeOrderWorkflow } from "@medusajs/medusa/core-flows"
import { getPartnerSalesChannelId, validatePartnerOrderOwnership } from "../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { salesChannelId } = await getPartnerSalesChannelId(req.auth_context, req.scope)

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order_exchange",
    fields: ["*", "*additional_items"],
    filters: {},
  })

  const orderIds = [...new Set((data || []).map((e: any) => e.order_id).filter(Boolean))]
  let validOrderIds: Set<string> = new Set()
  if (orderIds.length > 0) {
    const { data: orders } = await query.graph({
      entity: "orders",
      fields: ["id", "sales_channel_id"],
      filters: { id: orderIds },
    })
    validOrderIds = new Set(
      (orders || []).filter((o: any) => o.sales_channel_id === salesChannelId).map((o: any) => o.id)
    )
  }

  const exchanges = (data || []).filter((e: any) => validOrderIds.has(e.order_id))

  res.json({ exchanges })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const body = req.body as any
  await validatePartnerOrderOwnership(req.auth_context, body.order_id, req.scope)

  const { result } = await beginExchangeOrderWorkflow(req.scope).run({
    input: {
      ...body,
      created_by: req.auth_context.actor_id,
    },
  })

  res.json({ exchange: result })
}
