import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { ORDER_INVENTORY_MODULE } from "../../../../../modules/inventory_orders"
import {
  foldOrderCharges,
  orderPayableCeiling,
} from "../../../../../modules/inventory_orders/lib/order-charges"

/**
 * GET  /admin/inventory-orders/:id/charges
 * POST /admin/inventory-orders/:id/charges  { type, amount, note? }
 *
 * Amounts on an order that are not goods — tax, shipping, a discount or a
 * write-off (#1737).
 *
 * ## Why this exists
 *
 * Three turned up in one reconciliation and none had a home: 200 of tax on a
 * Terry Towel order, 1,960 of shipping on `inv_order_01K5QSCSK…`, and an 829
 * write-off on the same order. The model carried `total_price` and nothing
 * else, so an order whose real cost included freight understated it and a
 * settled remainder could not be recorded at all. The only writable home was
 * `metadata` — the trap #1557 closed, where an untyped blob decided payouts.
 *
 * ## What it moves
 *
 * 🔴 A charge changes the CEILING a claim may reach — `orderPayableCeiling`,
 * read by both `assessInventoryOrderClaims` (the write guard) and
 * `payable-inventory-orders` (the offer screen). Recording 200 of tax makes
 * 200 more billable; recording an 829 discount makes 829 less. This is a money
 * decision, which is why it is an explicit action and never inferred.
 *
 * ⚠️ It does NOT touch `total_price`. That column means "what was ordered" to
 * every reader, and widening it in place is the one-column-two-meanings trap
 * that already cost us `quantity` being a rate or a total (#1559).
 */

/** The types that REDUCE what a partner is owed. */
const LOWERING = new Set(["discount", "adjustment"])

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(ORDER_INVENTORY_MODULE)

  const [order] = (await service.listInventoryOrders({
    id: [req.params.id],
  })) as any[]
  if (!order) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Inventory order ${req.params.id} not found`
    )
  }

  const charges = (await service.listOrderCharges({
    inventory_orders_id: req.params.id,
  })) as any[]

  return res.status(200).json({
    charges,
    /** Folded here too, so a caller never re-derives the direction rule. */
    totals: foldOrderCharges(charges),
    goods_total: Number(order.total_price ?? 0),
    payable_ceiling: orderPayableCeiling(order, charges),
  })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.validatedBody ?? req.body ?? {}) as any
  const type = String(body.type ?? "").trim()
  const amount = Number(body.amount)
  const note = body.note == null ? null : String(body.note).trim()

  const service: any = req.scope.resolve(ORDER_INVENTORY_MODULE)

  const [order] = (await service.listInventoryOrders({
    id: [req.params.id],
  })) as any[]
  if (!order) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Inventory order ${req.params.id} not found`
    )
  }

  /**
   * ⚠️ A cancelled order is not owed, so nothing can be charged against it —
   * the same reasoning that stops a payment being recorded against one.
   */
  if (String(order.status) === "Cancelled") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Inventory order ${req.params.id} was cancelled — it is not owed, so no charge can be added to it.`
    )
  }

  /**
   * 🔴 A reduction has to say WHY, at the door.
   *
   * An 829 write-off with no reason is indistinguishable from an underpayment,
   * and that is exactly how this one was nearly lost: it sat as an unexplained
   * gap between 56,856.94 ordered and 58,000 paid, and read as an overpayment
   * until a human remembered the shipping. Required at the route rather than on
   * the column so historical rows can still be backfilled by a job that has no
   * reason to give.
   */
  if (LOWERING.has(type) && !note) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `A ${type} reduces what this partner is owed, so it must say why — send a 'note'. An unexplained reduction is indistinguishable from an underpayment.`
    )
  }

  const created = await service.createOrderCharges({
    type,
    amount,
    note,
    inventory_orders_id: req.params.id,
  })

  const charges = (await service.listOrderCharges({
    inventory_orders_id: req.params.id,
  })) as any[]

  return res.status(201).json({
    charge: Array.isArray(created) ? created[0] : created,
    totals: foldOrderCharges(charges),
    /** What a claim may now reach — the figure the guard will enforce. */
    payable_ceiling: orderPayableCeiling(order, charges),
  })
}
