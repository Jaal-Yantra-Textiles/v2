import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { tryGetPartnerSalesChannelId } from "../helpers"
import { PartnerGetOrdersKindParam } from "./validators"
import {
  buildPartnerOrderListParams,
  PARTNER_ORDER_LIST_FIELDS as DEFAULT_FIELDS,
} from "./list-params"
import { listPartnerOrdersWorkflow } from "../../../workflows/orders/list-partner-orders"

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
  const resolvedKind = kind ?? "retail"

  const { partner, salesChannelId } = await tryGetPartnerSalesChannelId(
    req.auth_context,
    req.scope
  )

  // #486: honor ALL the filter + sort params the partner-UI sends (date ranges,
  // region/sales-channel for retail, search) — not just status/q — plus the
  // `order` sort, mirroring admin. Pure helper keeps the param mapping testable.
  const { baseFilters, order, skip, take } = buildPartnerOrderListParams(
    (req.query as Record<string, unknown>) || {},
    resolvedKind
  )

  const { result } = await listPartnerOrdersWorkflow(req.scope).run({
    input: {
      partnerId: partner?.id ?? null,
      salesChannelId,
      kind: resolvedKind,
      fields: DEFAULT_FIELDS,
      baseFilters,
      order,
      skip,
      take,
    },
  })

  res.json(result)
}
