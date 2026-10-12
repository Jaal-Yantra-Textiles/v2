import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import {
  deleteRunRow,
  loadProfitShare,
  retrieveRunOrThrow,
} from "../../../../../../../workflows/production-runs/lib/profit-share-store"

/** DELETE /admin/production-runs/:id/profit-share/sales/:saleId — a mistaken sale. */
export const DELETE = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const run = await retrieveRunOrThrow(req.scope, req.params.id)
  await deleteRunRow(req.scope, run, "sale", req.params.saleId)
  res.json({ deleted: req.params.saleId, profit_share: await loadProfitShare(req.scope, run) })
}
