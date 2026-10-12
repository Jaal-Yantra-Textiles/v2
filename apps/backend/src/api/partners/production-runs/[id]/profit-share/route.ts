import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"

import {
  loadProfitShare,
  retrieveRunOrThrow,
} from "../../../../../workflows/production-runs/lib/profit-share-store"

/**
 * GET /partners/production-runs/:id/profit-share
 *
 * #2322 — the partner sees the same sales, payments and amount owed as we do.
 */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const partnerId = req.auth_context?.actor_id
  if (!partnerId) {
    return res.status(401).json({ error: "Partner authentication required" })
  }
  const run = await retrieveRunOrThrow(req.scope, req.params.id, partnerId)
  res.json({ profit_share: await loadProfitShare(req.scope, run) })
}
