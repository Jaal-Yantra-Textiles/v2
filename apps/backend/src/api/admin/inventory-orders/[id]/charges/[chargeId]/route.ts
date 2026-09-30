import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { ORDER_INVENTORY_MODULE } from "../../../../../../modules/inventory_orders"
import {
  foldOrderCharges,
  orderPayableCeiling,
  type OrderCharge,
} from "../../../../../../modules/inventory_orders/lib/order-charges"
import { PAYMENT_SUBMISSIONS_MODULE } from "../../../../../../modules/payment_submissions"
import { foldInventoryOrderClaims } from "../../../../../../workflows/payment_submissions/lib/run-claims"

/**
 * POST   /admin/inventory-orders/:id/charges/:chargeId  { amount?, note? }
 * DELETE /admin/inventory-orders/:id/charges/:chargeId
 *
 * Correct or remove ONE charge on an order (#2315).
 *
 * ## Why this exists
 *
 * A charge could only be ADDED. When J.P. Handloom's order
 * `inv_order_01M3BZ2E3M0X4JW9MGD7FPWABM` was cut from ₹45,717 to ₹17,955 of
 * goods, its 5% tax stayed at ₹2,285.85 — ₹1,388.10 more than is owed — and
 * the only correction available was a second, offsetting charge, so the order
 * would read as two tax facts that are really one.
 *
 * ## What it refuses
 *
 * 🔴 A change that would drop the payable ceiling BELOW what live payouts
 * already claim. The claim would stand over a ceiling that no longer supports
 * it, and the next reader would see an order overpaid by a correction nobody
 * reconciled. Reject or reduce the payout first.
 *
 * ⚠️ The type is not editable: a tax turned into a discount is a different
 * fact with the opposite direction. Remove it and add the right one.
 */

const LOWERING = new Set(["discount", "adjustment"])

const loadOrderAndCharge = async (req: MedusaRequest) => {
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
  if (String(order.status) === "Cancelled") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Inventory order ${req.params.id} was cancelled — its charges are no longer owed and cannot be changed.`
    )
  }

  const charges = (await service.listOrderCharges({
    inventory_orders_id: req.params.id,
  })) as any[]
  const charge = charges.find((c) => c.id === req.params.chargeId)
  if (!charge) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Charge ${req.params.chargeId} not found on inventory order ${req.params.id}`
    )
  }

  return { service, order, charges, charge }
}

/** What live payouts already claim on this order — Rejected ones release theirs. */
const claimedOnOrder = async (req: MedusaRequest, orderId: string) => {
  const submissions: any = req.scope.resolve(PAYMENT_SUBMISSIONS_MODULE)
  const items = (await submissions.listPaymentSubmissionItems({
    inventory_order_id: orderId,
  })) as any[]
  const submissionIds = [
    ...new Set(items.map((i) => i.submission_id).filter(Boolean)),
  ]
  const statusById = new Map<string, string>(
    submissionIds.length
      ? (
          (await submissions.listPaymentSubmissions({
            id: submissionIds,
          })) as any[]
        ).map((s) => [String(s.id), String(s.status)])
      : []
  )
  const folded = foldInventoryOrderClaims(
    items.map((i) => ({
      submission_id: i.submission_id,
      submission_status: statusById.get(String(i.submission_id)) ?? null,
      production_run_ids: null,
      inventory_order_id: i.inventory_order_id,
      amount: i.amount,
    })) as any
  )
  return folded.get(orderId)?.claimed_total ?? 0
}

const assertCeilingCoversClaims = async (
  req: MedusaRequest,
  order: any,
  nextCharges: OrderCharge[]
) => {
  const nextCeiling = orderPayableCeiling(order, nextCharges)
  const claimed = await claimedOnOrder(req, order.id)
  if (claimed > nextCeiling + 0.005) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `This change would make inventory order ${order.id} worth ${nextCeiling}, but live payouts ` +
        `already claim ${claimed} against it. Reject or reduce the payout first.`
    )
  }
  return nextCeiling
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.validatedBody ?? req.body ?? {}) as {
    amount?: number
    note?: string | null
  }
  const { service, order, charges, charge } = await loadOrderAndCharge(req)

  const note =
    body.note === undefined
      ? charge.note ?? null
      : body.note == null
        ? null
        : String(body.note).trim() || null

  // Same rule as the create route: a reduction must say why, and an edit
  // cannot strip the reason off one that already does.
  if (LOWERING.has(String(charge.type)) && !note) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `A ${charge.type} reduces what this partner is owed, so it must keep a 'note' saying why.`
    )
  }

  const amount = body.amount === undefined ? Number(charge.amount) : Number(body.amount)
  const nextCharges = charges.map((c) =>
    c.id === charge.id ? { ...c, amount } : c
  )
  await assertCeilingCoversClaims(req, order, nextCharges)

  await service.updateOrderCharges({ id: charge.id, amount, note })

  // Read the row back: a write that reports success may persist nothing.
  const after = (await service.listOrderCharges({
    inventory_orders_id: req.params.id,
  })) as any[]

  return res.status(200).json({
    charge: after.find((c) => c.id === charge.id) ?? null,
    previous: { amount: Number(charge.amount), note: charge.note ?? null },
    totals: foldOrderCharges(after),
    payable_ceiling: orderPayableCeiling(order, after),
  })
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { service, order, charges, charge } = await loadOrderAndCharge(req)

  const nextCharges = charges.filter((c) => c.id !== charge.id)
  await assertCeilingCoversClaims(req, order, nextCharges)

  await service.softDeleteOrderCharges(charge.id)

  const after = (await service.listOrderCharges({
    inventory_orders_id: req.params.id,
  })) as any[]

  return res.status(200).json({
    id: charge.id,
    deleted: true,
    removed: { type: charge.type, amount: Number(charge.amount), note: charge.note ?? null },
    totals: foldOrderCharges(after),
    payable_ceiling: orderPayableCeiling(order, after),
  })
}
