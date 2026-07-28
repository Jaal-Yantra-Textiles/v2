/**
 * @file Admin read-proxy: a partner's designs, as the partner sees them (#843).
 * @module API/Admin/Partners/Designs
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { listDesignsQuerySchema } from "../../../../partners/designs/validators"
import { listPartnerDesignsWorkflow } from "../../../../../workflows/designs/list-partner-designs"
import { resolvePartnerInspectionContext } from "../lib/partner-inspection"

/**
 * GET /admin/partners/:id/designs
 *
 * The inspection mirror of `GET /partners/designs`: same query contract
 * (`status`, `q`, `bucket`, `limit`, `offset`), same partner_status derivation,
 * same bucket facets — because it runs the same workflow, just with the partner
 * resolved from `:id` instead of from a partner bearer.
 *
 * READ-ONLY. There is deliberately no POST here: creating a design on a
 * partner's behalf is the audited impersonation track (approach #1 on #843).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: partnerId } = req.params

  // Parsed here rather than via `validateAndTransformQuery` middleware so this
  // route reads the partner schema itself — one contract, not two that can
  // drift apart.
  const { limit = 20, offset = 0, status, q, bucket } =
    listDesignsQuerySchema.parse((req.query as Record<string, unknown>) || {})

  // 404s on an unknown partner before any partner helper can voice a
  // partner-shaped UNAUTHORIZED at an admin caller.
  const { partner } = await resolvePartnerInspectionContext(partnerId, req.scope)

  const { result } = await listPartnerDesignsWorkflow(req.scope).run({
    input: {
      partnerId: partner.id,
      q,
      status,
      bucket,
      offset,
      limit,
      locale: req.locale,
    },
  })

  res.json(result)
}
