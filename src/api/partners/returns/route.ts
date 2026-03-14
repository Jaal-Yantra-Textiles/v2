import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { beginReturnOrderWorkflow } from "@medusajs/medusa/core-flows"
import { getPartnerSalesChannelId, validatePartnerOrderOwnership } from "../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { salesChannelId } = await getPartnerSalesChannelId(req.auth_context, req.scope)

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const filters: any = {}
  const reqQuery = req.query as any
  if (reqQuery.order_id) filters.order_id = reqQuery.order_id

  const { data } = await query.graph({
    entity: "return",
    fields: ["*", "*items", "*items.item"],
    filters,
  })

  // Filter to only returns whose order belongs to this partner's sales channel
  const orderIds = [...new Set((data || []).map((r: any) => r.order_id).filter(Boolean))]
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

  const returns = (data || []).filter((r: any) => validOrderIds.has(r.order_id))

  res.json({ returns })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const body = req.body as any
  await validatePartnerOrderOwnership(req.auth_context, body.order_id, req.scope)

  const { result } = await beginReturnOrderWorkflow(req.scope).run({
    input: {
      ...body,
      created_by: req.auth_context.actor_id,
    },
  })

  res.json({ return: result })
}
