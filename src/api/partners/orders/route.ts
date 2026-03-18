import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getOrdersListWorkflow } from "@medusajs/medusa/core-flows"
import { getPartnerSalesChannelId, tryGetPartnerSalesChannelId } from "../helpers"

const DEFAULT_FIELDS = [
  "id", "status", "created_at", "email", "display_id",
  "custom_display_id", "payment_status", "fulfillment_status",
  "total", "currency_code",
  "*customer", "*sales_channel", "*payment_collections",
]

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { salesChannelId } = await tryGetPartnerSalesChannelId(req.auth_context, req.scope)
  if (!salesChannelId) {
    return res.json({ orders: [], count: 0, offset: 0, limit: 20 })
  }

  const query = req.query || {}
  const limit = Number(query.limit) || 20
  const offset = Number(query.offset) || 0

  const { result } = await getOrdersListWorkflow(req.scope).run({
    input: {
      fields: DEFAULT_FIELDS,
      variables: {
        filters: {
          sales_channel_id: [salesChannelId],
          ...(query.status ? { status: query.status } : {}),
          ...(query.q ? { q: query.q } : {}),
        },
        skip: offset,
        take: limit,
      },
    },
  })

  const orders = Array.isArray(result) ? result : (result as any)?.rows || []
  const count = Array.isArray(result) ? result.length : (result as any)?.metadata?.count || orders.length

  res.json({
    orders,
    count,
    offset,
    limit,
  })
}
