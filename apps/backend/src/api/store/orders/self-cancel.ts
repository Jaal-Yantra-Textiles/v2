/**
 * Can a customer cancel this order themselves?
 *
 * Founder, 2026-11-26: only orders where no money has been taken and nothing
 * has gone out. In practice that is a cash order (pickup, `pp_system_default`,
 * payment authorized but never captured) that hasn't been fulfilled.
 *
 * A paid order is excluded on purpose: cancelling a captured PayU payment
 * marks it refunded without ever calling PayU (#2580), so the buyer would see
 * "refunded" and get nothing back. Those stay with the admin.
 */

export type SelfCancelOrder = {
  status?: string | null
  customer_id?: string | null
  fulfillments?: Array<{ canceled_at?: string | Date | null } | null> | null
  payment_collections?: Array<{
    payments?: Array<{
      captured_at?: string | Date | null
      captures?: Array<{ id?: string } | null> | null
    } | null> | null
  } | null> | null
}

export type SelfCancelVerdict =
  | { ok: true }
  | { ok: false; reason: string }

const OPEN_STATUSES = new Set(["pending", "requires_action"])

export function canCustomerCancel(
  order: SelfCancelOrder,
  customerId: string
): SelfCancelVerdict {
  if (!order.customer_id || order.customer_id !== customerId) {
    // Same answer as a missing order, so ids can't be probed.
    return { ok: false, reason: "Order not found" }
  }

  if (!order.status || !OPEN_STATUSES.has(order.status)) {
    return {
      ok: false,
      reason:
        order.status === "canceled"
          ? "This order is already cancelled"
          : "This order can no longer be cancelled",
    }
  }

  const liveFulfillment = (order.fulfillments ?? []).some(
    (f) => f && !f.canceled_at
  )
  if (liveFulfillment) {
    return {
      ok: false,
      reason: "This order is already being prepared or shipped",
    }
  }

  const paid = (order.payment_collections ?? []).some((pc) =>
    (pc?.payments ?? []).some(
      (p) => !!p && (!!p.captured_at || (p.captures ?? []).some(Boolean))
    )
  )
  if (paid) {
    return {
      ok: false,
      reason:
        "This order has been paid, so it can't be cancelled here. Contact the store to cancel it.",
    }
  }

  return { ok: true }
}

export const SELF_CANCEL_ORDER_FIELDS = [
  "id",
  "status",
  "customer_id",
  "fulfillments.id",
  "fulfillments.canceled_at",
  "payment_collections.payments.id",
  "payment_collections.payments.captured_at",
  "payment_collections.payments.captures.id",
]
