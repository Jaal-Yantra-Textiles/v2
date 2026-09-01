import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

import { PAYMENT_SUBMISSIONS_MODULE } from "../../../modules/payment_submissions"
import type PaymentSubmissionsService from "../../../modules/payment_submissions/service"
import { listPartnerClaims } from "./run-claims"
import { valueInventoryOrderByReceipts } from "./inventory-order-value"

/**
 * What a partner is owed for GOODS, as opposed to for work (#1612, #1710).
 *
 * ## Why this is a lib and not a route body
 *
 * There are two callers — `GET /admin/payment-submissions/payable-inventory-orders`
 * and `GET /partners/payment-submissions/payable-inventory-orders` — and this is
 * one question with one answer. The partner-facing copy of `foldPartnerBilling`
 * that `apps/partner-ui` kept privately is the warning: a fix landed in one home
 * and the other silently kept the old rule. One owner, two importers.
 *
 * 🔑 Everything below (receipts-derived value, the ordered-total ceiling, the
 * explicit `capped_by_ceiling` flag, listing unpayable orders rather than
 * hiding them) is the admin route's behaviour unchanged. The ONLY difference
 * between the callers is where `partnerId` comes from — the query string for an
 * admin, the auth context for a partner.
 */
export type PayableInventoryOrder = {
  inventory_order_id: string
  status: string | null
  is_sample: boolean
  currency_code: string | null
  /** What was ORDERED. This is the guard's ceiling. */
  ordered_total: number | null
  /** What the RECEIPTS are worth, before any cap. */
  receipts_total: number
  received_quantity: number
  lines: any[]
  /** Already billed across every live submission. */
  claimed_total: number
  /** What may still be billed — `null` when the order has no readable price. */
  remaining: number | null
  /** What this row bills if selected. */
  amount: number
  /** Whether `amount` is below `receipts_total` because the ceiling bit. */
  capped_by_ceiling: boolean
  order_date: string | null
  expected_delivery_date: string | null
  payable: boolean
  claims: Array<{ submission_id: string | null; status: string | null }>
}

export const listPayableInventoryOrders = async (
  container: MedusaContainer,
  partnerId: string
): Promise<PayableInventoryOrder[]> => {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

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
      // — the two disagree by INR 4,050 on a real order and these are what the
      // concurrency guard reads (#1613).
      "inventory_orders.orderlines.line_fulfillments.quantity_delta",
    ],
    filters: { id: partnerId },
  })

  const partner = ((partners || []) as any[])[0]
  const orders = (partner?.inventory_orders || []) as any[]

  const submissionService: PaymentSubmissionsService = container.resolve(
    PAYMENT_SUBMISSIONS_MODULE
  )
  const { inventoryOrders: claims } = await listPartnerClaims(
    submissionService as any,
    partnerId
  )

  return (Array.isArray(orders) ? orders : [orders])
    .filter(Boolean)
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
       * it — INR 64,274 derived against INR 63,375.75 ordered on the order that
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
        remaining == null
          ? uncapped
          : Math.round(Math.min(uncapped, remaining) * 100) / 100

      return {
        inventory_order_id: String(order.id),
        status: order.status ?? null,
        is_sample: !!order.is_sample,
        currency_code: order.currency_code ?? null,
        ordered_total: ceiling,
        receipts_total: uncapped,
        received_quantity: value.received_quantity,
        lines: value.lines,
        claimed_total: Math.round(claimedTotal * 100) / 100,
        remaining,
        amount,
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
}
