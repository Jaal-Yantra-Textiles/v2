import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getOrdersListWorkflow } from "@medusajs/medusa/core-flows"
import { getPartnerSalesChannelId, tryGetPartnerSalesChannelId } from "../helpers"

// IMPORTANT: use the `relation.*` suffix syntax, not `*relation` prefix.
//
// `getOrdersListWorkflow` -> `useRemoteQueryStep` -> `query.graph` only
// understands `relation.*` (expand all fields of a relation). The
// `*relation` form is admin's user-facing convention, but the admin
// middleware (`validateAndTransformQuery` -> `prepareListQuery`) rewrites
// it to `relation.*` before handing it to the workflow — see
// node_modules/@medusajs/framework/.../get-query-config.js#prepareListQuery.
// We don't run that middleware here, so we have to write the canonical
// form ourselves.
//
// Symptom of getting this wrong: `customer`, `sales_channel`, and
// `shipping_address` all come back as `null` in the response and even
// their `_id` scalars get dropped — the orders list table renders blank
// cells for those columns.
const DEFAULT_FIELDS = [
  "id", "status", "created_at", "email", "display_id",
  "custom_display_id", "payment_status", "fulfillment_status",
  "total", "currency_code",
  "customer_id",
  "sales_channel_id",
  "shipping_address_id",
  "customer.*",
  "sales_channel.*",
  "payment_collections.*",
  "shipping_address.*",
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
