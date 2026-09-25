/**
 * @file Admin read-proxy: a partner's inventory, as the partner sees it (#843).
 * @module API/Admin/Partners/InventoryItems
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { listPartnerInventoryItemsWorkflow } from "../../../../../workflows/inventory/list-partner-inventory-items"
import { resolvePartnerInspectionContext } from "../lib/partner-inspection"
import { resolvePartnerHomeLocation } from "../../../../partners/lib/partner-home-location"

/**
 * The partner route reads `q`/`limit`/`offset` straight off the request with no
 * schema of its own, so there is none to reuse here.
 *
 * Deliberately NO `store_id` selector, unlike the products mirror: the partner
 * inventory surface has no multi-store notion at all — it reads the partner's
 * home location (#2286: their store's default location, else their linked
 * warehouse) and nothing else. Offering a store picker here
 * would make the mirror show something the partner cannot see, which is the one
 * thing it must never do.
 */
const inspectInventoryQuerySchema = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().optional(),
  offset: z.coerce.number().optional(),
})

/**
 * GET /admin/partners/:id/inventory-items
 *
 * The inspection mirror of `GET /partners/inventory-items`: the same stock
 * location scoping, the same per-location quantity aggregation, the same
 * search-then-paginate semantics — because it runs the same workflow, just with
 * the partner resolved from `:id` instead of from a partner bearer.
 *
 * A partner with neither a store location nor a linked warehouse has no
 * inventory to show — an empty list, not an error. That is exactly what the
 * partner route returns them, and it is a state the operator wants to SEE.
 *
 * READ-ONLY. There is deliberately no POST here (the partner route has one);
 * writing stock on a partner's behalf is the audited impersonation track.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const {
    q,
    limit = 20,
    offset = 0,
  } = inspectInventoryQuerySchema.parse(
    (req.query as Record<string, unknown>) || {}
  )

  // 404s on an unknown partner before any partner helper can voice a
  // partner-shaped UNAUTHORIZED at an admin caller.
  const { authContext } = await resolvePartnerInspectionContext(
    req.params.id,
    req.scope
  )

  // The location — not the store — is this surface's scoping rule, resolved via
  // the partner portal's own helper so admin cannot scope it differently.
  const { location_id: locationId } = await resolvePartnerHomeLocation(authContext, req.scope)

  if (!locationId) {
    return res.json({ inventory_items: [], count: 0, offset, limit })
  }

  const { result } = await listPartnerInventoryItemsWorkflow(req.scope).run({
    input: { locationId, q, offset, limit },
  })

  res.json(result)
}
