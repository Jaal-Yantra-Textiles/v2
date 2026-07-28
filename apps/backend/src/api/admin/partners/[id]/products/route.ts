/**
 * @file Admin read-proxy: a partner's catalog, as the partner sees it (#843).
 * @module API/Admin/Partners/Products
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { listStoreProductsWorkflow } from "../../../../../workflows/partner/list-store-products"
import {
  resolvePartnerInspectionContext,
  resolvePartnerInspectionStoreId,
} from "../lib/partner-inspection"

/**
 * On the partner side the store is a PATH param (`GET /partners/stores/:id/
 * products`), so there is no partner query schema to reuse here — unlike the
 * orders/designs/runs mirrors, which parse the partner's own schema. `store_id`
 * is this route's way of spelling that path param, and nothing else is accepted.
 */
const inspectProductsQuerySchema = z.object({
  store_id: z.string().optional(),
})

/**
 * GET /admin/partners/:id/products
 *
 * The inspection mirror of `GET /partners/stores/:storeId/products`: the same
 * sales-channel-scoped catalog, the same field set, the same payload — because
 * it runs the same workflow, just with the partner resolved from `:id` instead
 * of from a partner bearer.
 *
 * Store selection: `?store_id=` picks a specific store; otherwise the partner's
 * first store is used, which is the one the partner portal itself lands on. A
 * `store_id` belonging to another partner 404s — the mirror is never more
 * permissive than the surface it mirrors.
 *
 * READ-ONLY. There is deliberately no POST here: creating a product on a
 * partner's behalf is the audited impersonation track (approach #1 on #843).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: partnerId } = req.params

  const { store_id: requestedStoreId } = inspectProductsQuerySchema.parse(
    (req.query as Record<string, unknown>) || {}
  )

  // 404s on an unknown partner before any partner helper can voice a
  // partner-shaped UNAUTHORIZED at an admin caller.
  const { authContext } = await resolvePartnerInspectionContext(
    partnerId,
    req.scope
  )

  const { partner, storeId } = await resolvePartnerInspectionStoreId(
    authContext,
    req.scope,
    requestedStoreId
  )

  // A partner with no store yet is a normal state an operator wants to SEE (it
  // is what the onboarding flow exists to fix), not an error (#1158).
  if (!storeId) {
    return res.json({
      products: [],
      count: 0,
      offset: 0,
      limit: 20,
      store_id: null,
    })
  }

  const { result } = await listStoreProductsWorkflow(req.scope).run({
    input: {
      partnerId: partner.id,
      storeId,
    },
  })

  res.json(result)
}
