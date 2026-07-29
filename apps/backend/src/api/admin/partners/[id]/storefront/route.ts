/**
 * @file Admin read-proxy: a partner's storefront hosting status (#843).
 * @module API/Admin/Partners/Storefront
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { getPartnerStorefrontStatusWorkflow } from "../../../../../workflows/partners/get-partner-storefront-status"
import { getPartnerInspectionRecord } from "../lib/partner-inspection"

/**
 * GET /admin/partners/:id/storefront
 *
 * The inspection mirror of `GET /partners/storefront`.
 *
 * This route PRE-DATES the #843 mirror and used to hand-roll its own copy of
 * the partner logic — which had already drifted: it omitted the
 * provider-not-resolvable branch, the `vercel_configured` /
 * `cloudflare_configured` flags, and the stale-project detection. It now runs
 * the same workflow the partner route runs, so the two cannot diverge again.
 *
 * READ-ONLY. The partner route clears a partner's stale provider refs when the
 * project has vanished; this one reports that state via `stale_project` and
 * writes nothing. An operator opening a tab must never mutate a partner record.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: partnerId } = req.params

  // 404s on an unknown partner before any partner-voiced error can reach an
  // admin caller.
  const partner = await getPartnerInspectionRecord(partnerId, req.scope)

  const { result: status } = await getPartnerStorefrontStatusWorkflow(
    req.scope
  ).run({ input: { partner } })

  res.json(status)
}
