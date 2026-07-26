/**
 * @file Admin read-proxy: a partner's orders, as the partner sees them (#843).
 * @module API/Admin/Partners/Orders
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { tryGetPartnerSalesChannelId } from "../../../../partners/helpers"
import { PartnerGetOrdersKindParam } from "../../../../partners/orders/validators"
import {
  buildPartnerOrderListParams,
  PARTNER_ORDER_LIST_FIELDS,
} from "../../../../partners/orders/list-params"
import { listPartnerOrdersWorkflow } from "../../../../../workflows/orders/list-partner-orders"
import { resolvePartnerInspectionContext } from "../lib/partner-inspection"

/**
 * GET /admin/partners/:id/orders
 *
 * The inspection mirror of `GET /partners/orders`: same `?kind=` discriminator,
 * same filters/sort/pagination, same field set, same scoping — because it runs
 * the same param helper and the same workflow, just with the partner resolved
 * from `:id` instead of from a partner bearer.
 *
 * READ-ONLY. There is deliberately no POST/PATCH here: writing on a partner's
 * behalf is the audited impersonation track (approach #1 on #843), not this one.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: partnerId } = req.params

  const { kind } = PartnerGetOrdersKindParam.parse({
    kind: (req.query as Record<string, unknown>)?.kind,
  })
  const resolvedKind = kind ?? "retail"

  // 404s on an unknown partner before any partner helper can voice a
  // partner-shaped UNAUTHORIZED at an admin caller.
  const { authContext } = await resolvePartnerInspectionContext(
    partnerId,
    req.scope
  )

  const { partner, salesChannelId } = await tryGetPartnerSalesChannelId(
    authContext,
    req.scope
  )

  const { baseFilters, order, skip, take } = buildPartnerOrderListParams(
    (req.query as Record<string, unknown>) || {},
    resolvedKind
  )

  const { result } = await listPartnerOrdersWorkflow(req.scope).run({
    input: {
      partnerId: partner?.id ?? null,
      salesChannelId,
      kind: resolvedKind,
      fields: PARTNER_ORDER_LIST_FIELDS,
      baseFilters,
      order,
      skip,
      take,
    },
  })

  res.json(result)
}
