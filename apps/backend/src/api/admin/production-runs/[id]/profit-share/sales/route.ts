import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import {
  RecordSaleSchema,
  loadProfitShare,
  parseOrThrow,
  recordSale,
  retrieveRunOrThrow,
} from "../../../../../../workflows/production-runs/lib/profit-share-store"

/**
 * POST /admin/production-runs/:id/profit-share/sales
 *   { quantity, unit_price, currency_code?, sold_at?, note? }
 *
 * #2322 — record pieces the partner sold, at their GROSS unit price.
 */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const body = parseOrThrow(RecordSaleSchema, req.body)
  const run = await retrieveRunOrThrow(req.scope, req.params.id)
  const sale = await recordSale(req.scope, run, body, {
    type: "admin",
    id: req.auth_context?.actor_id ?? null,
  })
  res.status(201).json({ sale, profit_share: await loadProfitShare(req.scope, run) })
}
