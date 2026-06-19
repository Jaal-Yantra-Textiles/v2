/**
 * Pure fee math for #336 partner transaction-fee billing.
 *
 * Kept dependency-free so it is trivially unit-testable and reusable by the
 * accrual subscriber (Slice 2) and the historical backfill job (Slice 5).
 */

export type FeeBasis = "percentage" | "flat"

/**
 * Compute the platform commission for an order.
 *
 * - `percentage`: `rate` is basis points (bps). 200 bps = 2.00%. fee = total * rate / 10000.
 * - `flat`: `rate` is a flat amount in the order currency, capped at the order total.
 *
 * Returns 0 for any non-positive / non-finite input (never throws — accrual must
 * never break order placement). Rounded to 2 decimals (the dominant currency
 * precision: INR/EUR/USD). Zero-decimal currencies (e.g. JPY) are a future concern.
 */
export function computeFee(
  orderTotal: number,
  basis: FeeBasis,
  rate: number
): number {
  const total = Number(orderTotal)
  const r = Number(rate)

  if (!Number.isFinite(total) || total <= 0) {
    return 0
  }
  if (!Number.isFinite(r) || r <= 0) {
    return 0
  }

  const raw = basis === "flat" ? Math.min(r, total) : (total * r) / 10000

  return Math.round(raw * 100) / 100
}

/**
 * Parse the platform-default fee rate (basis points) from an env value.
 * Falls back to `fallbackBps` (default 200 = 2%) when unset/invalid.
 */
export function parsePlatformFeeBps(
  raw: string | undefined,
  fallbackBps = 200
): number {
  if (raw == null || raw === "") {
    return fallbackBps
  }
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) {
    return fallbackBps
  }
  return Math.trunc(n)
}
