import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"

import { PAYMENT_SUBMISSIONS_MODULE } from "../../../../modules/payment_submissions"
import type PaymentSubmissionsService from "../../../../modules/payment_submissions/service"
import { listPartnerClaims } from "../../../../workflows/payment_submissions/lib/run-claims"
import { valueInventoryOrderByReceipts } from "../../../../workflows/payment_submissions/lib/inventory-order-value"

/**
 * GET /admin/payment-submissions/payable-inventory-orders?partner_id=…
 *
 * What a partner is owed for GOODS, as opposed to for work.
 *
 * ## Why this exists
 *
 * An inventory order is goods coming IN; a production run is the WORK. Both are
 * things a partner is paid for, and `create` has accepted
 * `inventory_order_lines` — with a validator, a partner-ownership guard and
 * read-side resolution — since #1612. Nothing ever sent one, because no screen
 * offered them: on production, NO payment carries an `inventory_order_id`. A
 * capability with no way to reach it is a capability nobody has.
 *
 * ## What it offers, and what it refuses to invent
 *
 * The value is derived from RECEIPTS, never from `total_price`. An order placed
 * for ₹88,885 with ₹28,670 actually delivered is owed ₹28,670 — billing the
 * ordered total there overpays by ₹60,215, and asking an operator to work it
 * out by hand invites it to be got wrong once per order (#1612).
 *
 * An order with no receipts is listed and marked `payable: false` rather than
 * hidden. "Why isn't this order here" is the question an operator arrives with,
 * and a delivered order that recorded no receipt is a gap in the record — not a
 * statement that the goods were free.
 *
 * 🔑 Already-claimed orders come from `listPartnerClaims`, the same fold the
 * write guard refuses on. A screen offering what the guard will reject teaches
 * an operator about the rule through a 400.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const partnerId = String(
    (req.validatedQuery as any)?.partner_id ??
      (req.query as any)?.partner_id ??
      ""
  ).trim()

  if (!partnerId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "partner_id is required"
    )
  }

  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  /**
   * ⚠️ Reached through the PARTNER, not by filtering inventory orders on a
   * partner column — there is no such column. `partner-inventory-order` is a
   * list link, so the orders arrive nested.
   */
  const { data: partners } = await query.graph({
    entity: "partner",
    fields: [
      "id",
      "inventory_orders.id",
      "inventory_orders.status",
      "inventory_orders.total_price",
      "inventory_orders.currency_code",
      "inventory_orders.expected_delivery_date",
      "inventory_orders.order_date",
      "inventory_orders.is_sample",
      "inventory_orders.orderlines.id",
      "inventory_orders.orderlines.quantity",
      "inventory_orders.orderlines.price",
      "inventory_orders.orderlines.material_name",
      // 🔴 The receipts. The typed rows, never `metadata.partner_delivery_history`
      // — the two disagree by ₹4,050 on a real order and these are what the
      // concurrency guard reads (#1613).
      "inventory_orders.orderlines.line_fulfillments.quantity_delta",
    ],
    filters: { id: partnerId },
  })

  const partner = ((partners || []) as any[])[0]
  const orders = (partner?.inventory_orders || []) as any[]

  const submissionService: PaymentSubmissionsService = req.scope.resolve(
    PAYMENT_SUBMISSIONS_MODULE
  )
  const { inventoryOrders: claims } = await listPartnerClaims(
    submissionService as any,
    partnerId
  )

  const payable_inventory_orders = orders
    /**
     * A cancelled order is not a debt. Everything else is listed — including
     * Pending and Processing, because a receipt can legitimately be recorded
     * before the status catches up, and an order with goods in it is payable
     * whatever the workflow calls it.
     */
    .filter((order) => String(order?.status || "") !== "Cancelled")
    .map((order) => {
      const value = valueInventoryOrderByReceipts(order.orderlines || [])
      const claim = claims.get(String(order.id)) ?? null
      const claimedTotal = claim?.claimed_total ?? 0

      /**
       * 🔴 The CEILING is the ordered total, not the receipts value.
       *
       * `assessInventoryOrderClaims` refuses anything that would take an order
       * past `total_price`, and the receipts figure can legitimately sit ABOVE
       * it — ₹64,274 derived against ₹63,375.75 ordered on the order that
       * opened #1617. An amountless line defaults to the receipts figure and is
       * refused there. So the screen has to know BOTH numbers, or it offers a
       * figure the guard rejects and the operator learns the rule from a 400.
       */
      const ordered = Number(order.total_price ?? 0)
      const ceiling = Number.isFinite(ordered) && ordered > 0 ? ordered : null

      const remaining =
        ceiling == null
          ? null
          : Math.round(Math.max(0, ceiling - claimedTotal) * 100) / 100

      /**
       * What this row offers: the receipts value, capped at what is left.
       *
       * Capping rather than offering the raw figure is the whole point — but a
       * silent cap is a reduction nobody decided, so `capped_by_ceiling` says
       * it happened and the raw figure stays on the row beside it.
       */
      const uncapped = value.total
      const amount =
        remaining == null ? uncapped : Math.round(Math.min(uncapped, remaining) * 100) / 100

      return {
        inventory_order_id: String(order.id),
        status: order.status ?? null,
        is_sample: !!order.is_sample,
        currency_code: order.currency_code ?? null,
        /** What was ORDERED. This is the guard's ceiling. */
        ordered_total: ceiling,
        /** What the RECEIPTS are worth, before any cap. */
        receipts_total: uncapped,
        received_quantity: value.received_quantity,
        lines: value.lines,
        /** Already billed across every live submission. */
        claimed_total: Math.round(claimedTotal * 100) / 100,
        /** What may still be billed — `null` when the order has no readable price. */
        remaining,
        /** What this row bills if selected. */
        amount,
        /** Whether `amount` is below `receipts_total` because the ceiling bit. */
        capped_by_ceiling: remaining != null && uncapped > remaining,
        order_date: order.order_date ?? null,
        expected_delivery_date: order.expected_delivery_date ?? null,
        /**
         * Whether there is anything to bill. False means either no receipt has
         * been recorded — a gap in the record, not a price of zero — or the
         * order is fully claimed already.
         */
        payable: amount > 0,
        /** Who holds the live claims on this order, earliest first. */
        claims: (claim?.claims || []).map((c) => ({
          submission_id: c.submission_id,
          status: c.submission_status,
        })),
      }
    })

  return res.status(200).json({
    payable_inventory_orders,
    count: payable_inventory_orders.length,
  })
}
