/**
 * Pure derivation of a cart's checkout status, for `GET
 * /store/carts/:id/checkout-status`. A cart is "completed" once it has been
 * turned into an order — detected by the order↔cart link (`order_cart`) and/or
 * the cart's own `completed_at`. Kept pure for unit tests.
 */
export type CheckoutStatus = {
  status: "pending" | "completed"
  order_id: string | null
  completed_at: string | null
}

export function deriveCheckoutStatus(
  cart: { completed_at?: string | Date | null } | null | undefined,
  orderId: string | null | undefined
): CheckoutStatus {
  const completedAt = cart?.completed_at ?? null
  const order_id = orderId ?? null
  const status: CheckoutStatus["status"] =
    order_id || completedAt ? "completed" : "pending"
  return {
    status,
    order_id,
    completed_at: completedAt
      ? completedAt instanceof Date
        ? completedAt.toISOString()
        : String(completedAt)
      : null,
  }
}
