/**
 * POST /admin/inventory-orders/:id/shortfalls/:shortfallId/resolve — #2289 S3.
 *
 * Close a short delivery with what was done about it: re-sent, credited,
 * written off. Moves no stock and no money; the note is the record. Goods that
 * simply turn up later resolve their shortfall on their own when counted.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { FULLFILLED_ORDERS_MODULE } from "../../../../../../../modules/fullfilled_orders"
import type { ResolveShortfall } from "./validators"

export const POST = async (req: MedusaRequest<ResolveShortfall>, res: MedusaResponse) => {
  const { id, shortfallId } = req.params
  const { note } = req.validatedBody
  const fulfilled: any = req.scope.resolve(FULLFILLED_ORDERS_MODULE)
  const [row] = await fulfilled.listInventoryShortfalls({ id: shortfallId, inventory_order_id: id }, { take: 1 })
  if (!row) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Shortfall ${shortfallId} not found on order ${id}`)
  }
  if (row.status !== "open") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Shortfall ${shortfallId} is already resolved`)
  }
  const shortfall = await fulfilled.updateInventoryShortfalls({
    id: shortfallId,
    status: "resolved",
    resolved_at: new Date(),
    resolution_note: note,
  })
  res.json({ shortfall })
}
