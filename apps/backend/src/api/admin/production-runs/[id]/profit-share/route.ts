import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import {
  SetProfitShareSchema,
  loadProfitShare,
  parseOrThrow,
  retrieveRunOrThrow,
  setProfitSharePercent,
} from "../../../../../workflows/production-runs/lib/profit-share-store"

/**
 * GET /admin/production-runs/:id/profit-share
 *
 * #2322 — the run's profit-share arrangement, the sales the partner made, the
 * payments they made us, and what is still owed (computed, with its working).
 */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const run = await retrieveRunOrThrow(req.scope, req.params.id)
  res.json({ profit_share: await loadProfitShare(req.scope, run) })
}

/**
 * POST /admin/production-runs/:id/profit-share  { percent: 0-100 | null }
 *
 * Set (or remove, with null) the share of gross sales the partner pays us.
 */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const body = parseOrThrow(SetProfitShareSchema, req.body)
  const run = await retrieveRunOrThrow(req.scope, req.params.id)
  const updated = await setProfitSharePercent(req.scope, run, body.percent)
  res.json({ profit_share: await loadProfitShare(req.scope, updated) })
}
