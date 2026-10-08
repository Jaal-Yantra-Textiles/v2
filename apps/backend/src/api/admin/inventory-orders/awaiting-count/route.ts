/**
 * GET /admin/inventory-orders/awaiting-count — #2289 S2.
 *
 * Inventory orders a supplier dispatched that nobody has counted yet. Since
 * #2289 S1 a dispatch posts no stock, so until someone counts these goods
 * (Receive goods, or the receiving partner's confirm) they are not on the books.
 *
 * Oldest dispatch first. Optional `?destination_location_id=` narrows to one
 * warehouse (our own, for the admin's to-do list).
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { listOrdersAwaitingCount } from "../../../../workflows/inventory_orders/lib/awaiting-count"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const destination = typeof req.query.destination_location_id === "string"
    ? req.query.destination_location_id
    : undefined
  const all = await listOrdersAwaitingCount(req.scope)
  const orders = destination
    ? all.filter((o) => o.destination_location_id === destination)
    : all
  res.json({
    orders,
    count: orders.length,
    awaiting_quantity: Math.round(orders.reduce((s, o) => s + o.awaiting_quantity, 0) * 1000) / 1000,
  })
}
