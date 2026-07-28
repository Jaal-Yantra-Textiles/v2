/**
 * @file Admin read-proxy: a partner's inventory orders, as the partner sees
 *   them (#843).
 * @module API/Admin/Partners/InventoryOrders
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { listInventoryOrdersQuerySchema } from "../../../inventory-orders/validators"
import { listPartnerInventoryOrdersWorkflow } from "../../../../../workflows/inventory_orders/list-partner-inventory-orders"
import { resolvePartnerInspectionContext } from "../lib/partner-inspection"

/**
 * GET /admin/partners/:id/inventory-orders
 *
 * The inspection mirror of `GET /partners/inventory-orders`: same query
 * contract (`status`, `q`, `limit`, `offset`), same task-derived
 * `partner_info`, same in-app filter-then-paginate semantics — because it runs
 * the same workflow, just with the partner resolved from `:id` instead of from
 * a partner bearer.
 *
 * READ-ONLY. Acting on a partner's inventory orders is the audited
 * impersonation track (approach #1 on #843), not this one.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: partnerId } = req.params

  // Parsed here rather than via `validateAndTransformQuery` middleware so this
  // route reads the partner's contract itself — one contract, not two that can
  // drift apart.
  //
  // That contract is the ADMIN `listInventoryOrdersQuerySchema`, which is what
  // the `/partners/inventory-orders` matcher validates with — NOT the schema in
  // `partners/inventory-orders/validators.ts`, which only supplies a type and
  // is far looser (`status: string` vs the real status enum). Parsing the loose
  // one made this mirror accept `?status=pending`, which the partner surface
  // rejects with a 400 — the mirror being more permissive than the thing it
  // mirrors. The drift guard caught it; keep it pointed here.
  const { limit = 20, offset = 0, status, q } =
    listInventoryOrdersQuerySchema.parse(
      (req.query as Record<string, unknown>) || {}
    )

  // 404s on an unknown partner before any partner helper can voice a
  // partner-shaped UNAUTHORIZED at an admin caller.
  const { partner } = await resolvePartnerInspectionContext(partnerId, req.scope)

  const { result } = await listPartnerInventoryOrdersWorkflow(req.scope).run({
    input: {
      partnerId: partner.id,
      q,
      status,
      offset,
      limit,
      locale: req.locale,
    },
  })

  res.json(result)
}
