import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import {
  RecordSettlementSchema,
  loadProfitShare,
  parseOrThrow,
  recordSettlement,
  retrieveRunOrThrow,
} from "../../../../../../workflows/production-runs/lib/profit-share-store"

/**
 * POST /admin/production-runs/:id/profit-share/settlements
 *   { amount, method: "bank_transfer" | "cash", paid_at?, reference?, receipt_url?, note? }
 *
 * #2322 — record money the partner paid US. Recorded, not collected.
 */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const body = parseOrThrow(RecordSettlementSchema, req.body)
  const run = await retrieveRunOrThrow(req.scope, req.params.id)
  const settlement = await recordSettlement(
    req.scope,
    run,
    body,
    req.auth_context?.actor_id ?? null
  )
  res.status(201).json({ settlement, profit_share: await loadProfitShare(req.scope, run) })
}
