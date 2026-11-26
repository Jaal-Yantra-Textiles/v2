import { HttpTypes } from "@medusajs/types"

import { isManual } from "@lib/constants"

/**
 * What a buyer should read about an order's payment, and whether they may
 * cancel it themselves.
 *
 * A cash order (pp_system_default, "Cash on delivery") is placed with its
 * payment AUTHORIZED, not taken: nobody has paid yet. Every order used to land
 * on "Order Confirmed … placed successfully" and show "Payment status:
 * Authorized", so a cash buyer read it as confirmed and paid.
 */

type OrderLike = Pick<
  HttpTypes.StoreOrder,
  "status" | "fulfillment_status" | "payment_status"
> & {
  payment_collections?: Array<{
    payments?: Array<{ provider_id?: string | null } | null> | null
  } | null> | null
}

const UNPAID = new Set(["not_paid", "awaiting", "authorized"])

export function isCashOrder(order: OrderLike): boolean {
  return (order.payment_collections ?? []).some((pc) =>
    (pc?.payments ?? []).some((p) => isManual(p?.provider_id ?? undefined))
  )
}

const humanise = (s?: string | null) => {
  if (!s) return ""
  const t = s.split("_").join(" ")
  return t.slice(0, 1).toUpperCase() + t.slice(1)
}

export function paymentStatusLabel(order: OrderLike): string {
  if (order.status === "canceled") return "Cancelled"
  if (isCashOrder(order) && UNPAID.has(order.payment_status)) {
    return "To be paid in cash"
  }
  if (order.payment_status === "authorized") return "Authorized, not charged yet"
  if (order.payment_status === "captured") return "Paid"
  return humanise(order.payment_status)
}

export function orderStatusLabel(order: OrderLike): string {
  if (order.status === "canceled") return "Cancelled"
  return humanise(order.fulfillment_status)
}

/**
 * Mirrors the backend rule (apps/backend/src/api/store/orders/self-cancel.ts):
 * open, nothing fulfilled, nothing captured. The server re-checks; this only
 * decides whether to show the button.
 */
export function canSelfCancel(order: OrderLike): boolean {
  return (
    (order.status === "pending" || order.status === "requires_action") &&
    order.fulfillment_status === "not_fulfilled" &&
    UNPAID.has(order.payment_status)
  )
}
