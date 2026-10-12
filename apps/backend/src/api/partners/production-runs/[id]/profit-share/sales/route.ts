import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"

import {
  RecordSaleSchema,
  loadProfitShare,
  parseOrThrow,
  recordSale,
  retrieveRunOrThrow,
} from "../../../../../../workflows/production-runs/lib/profit-share-store"

/**
 * POST /partners/production-runs/:id/profit-share/sales
 *   { quantity, unit_price, currency_code?, sold_at?, note? }
 *
 * #2322 — the partner reports pieces they sold from a run made on our
 * material. Partial reports are ordinary (4 of 10 this month).
 */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const partnerId = req.auth_context?.actor_id
  if (!partnerId) {
    return res.status(401).json({ error: "Partner authentication required" })
  }
  const body = parseOrThrow(RecordSaleSchema, req.body)
  const run = await retrieveRunOrThrow(req.scope, req.params.id, partnerId)
  const sale = await recordSale(req.scope, run, body, { type: "partner", id: partnerId })
  res.status(201).json({ sale, profit_share: await loadProfitShare(req.scope, run) })
}
