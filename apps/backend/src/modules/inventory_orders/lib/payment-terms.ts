/**
 * When a supplier may be paid for an inventory order (#2315).
 *
 * 🔴 ONE place, for the same reason as `order-charges.ts`: the payable offer
 * (`payable-inventory-orders`) and the submit guard
 * (`assessInventoryOrderClaims`) both ask this function, so a screen can never
 * offer an advance the guard then refuses — or the reverse.
 *
 * PURE, so the money decision is testable without a database.
 */

export const PAYMENT_TERMS = ["on_receipt", "advance"] as const
export type PaymentTerms = (typeof PAYMENT_TERMS)[number]

export type OrderPaymentTerms = {
  payment_terms?: PaymentTerms | string | null
  advance_percent?: number | string | null
  is_sample?: boolean | null
}

/**
 * Why the limit is what it is — so a refusal can say which rule bit.
 *
 * - `received`: goods have arrived, the whole ceiling is billable (today's rule).
 * - `sample`: a swatch order posts no receipts by design, so it was never gated
 *   on them and is not now.
 * - `advance`: nothing received yet, the order's terms allow this share early.
 * - `awaiting_receipt`: nothing received yet and the order is paid on receipt.
 */
export type BillableBasis = "received" | "sample" | "advance" | "awaiting_receipt"

export type BillableLimit = {
  /** The most this order may have billed IN TOTAL, across every live claim. */
  limit: number
  basis: BillableBasis
  /** The advance share actually applied, 0 when the order is not `advance`. */
  advance_percent: number
}

const round = (value: number): number => Math.round(value * 100) / 100

/**
 * PURE: the advance share, clamped to 0–100.
 *
 * ⚠️ `0` is a real answer, not a missing one. An `advance` order with no
 * percent, or garbage in it, allows NOTHING early — it never falls back to
 * 100%, because an absent number defaulting to "pay it all now" is the one
 * failure here that sends money out of the door.
 */
export const orderAdvancePercent = (
  order: OrderPaymentTerms | null | undefined
): number => {
  if (order?.payment_terms !== "advance") return 0
  const raw = order.advance_percent
  if (raw === null || raw === undefined || raw === "") return 0
  const pct = Number(raw)
  if (!Number.isFinite(pct)) return 0
  return Math.min(100, Math.max(0, pct))
}

/**
 * PURE: how much of `ceiling` this order may have billed, given what has been
 * received.
 *
 * 🔑 Once ANY goods are received, the order is billable up to its full
 * ceiling, exactly as before this existed — the receipts-based offer and the
 * ceiling guard already handle partial deliveries. This only decides the
 * window BEFORE the first receipt.
 */
export const orderBillableLimit = (
  order: OrderPaymentTerms | null | undefined,
  ceiling: number,
  receivedQuantity: number
): BillableLimit => {
  const advance_percent = orderAdvancePercent(order)

  if (order?.is_sample) {
    return { limit: ceiling, basis: "sample", advance_percent }
  }
  if (receivedQuantity > 0) {
    return { limit: ceiling, basis: "received", advance_percent }
  }
  if (advance_percent > 0) {
    return {
      limit: round((ceiling * advance_percent) / 100),
      basis: "advance",
      advance_percent,
    }
  }
  return { limit: 0, basis: "awaiting_receipt", advance_percent }
}
