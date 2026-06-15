import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { tryGetPartnerSalesChannelId } from "../helpers"
import { PartnerGetOrdersKindParam } from "./validators"
import { listPartnerOrdersWorkflow } from "../../../workflows/orders/list-partner-orders"

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
  // Chunk 5 (T3.4): kind is the route `?kind=` param (link-derived, Chunk 6).
  // Chunk 9b / PR-G: the work-status badge now reads the typed
  // `unified_order_status.partner_status` column (PR-F sidecar) via the link
  // accessor — the authoritative source. `metadata` stays surfaced only as a
  // transitional fallback for rows not yet backfilled; PR-H drops it.
  "unified_order_status.partner_status",
  "metadata",
]

// Chunk 5 (T3.4, #342): the partner orders list is `?kind=`-aware (retail |
// design | inventory | all), mirroring admin's Chunk 4 contract. The route is
// thin — it resolves the partner + their sales channel from auth and delegates
// all kind discrimination / scoping / listing to listPartnerOrdersWorkflow.
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { kind } = PartnerGetOrdersKindParam.parse({
    kind: (req.query as Record<string, unknown>)?.kind,
  })

  const { partner, salesChannelId } = await tryGetPartnerSalesChannelId(
    req.auth_context,
    req.scope
  )

  const query = req.query || {}
  const limit = Number(query.limit) || 20
  const offset = Number(query.offset) || 0

  const { result } = await listPartnerOrdersWorkflow(req.scope).run({
    input: {
      partnerId: partner?.id ?? null,
      salesChannelId,
      kind: kind ?? "retail",
      fields: DEFAULT_FIELDS,
      baseFilters: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.q ? { q: query.q } : {}),
      },
      skip: offset,
      take: limit,
    },
  })

  res.json(result)
}
