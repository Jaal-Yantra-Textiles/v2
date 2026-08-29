/**
 * How a per-piece breakdown READS (#1596) — the display half, deliberately
 * apart from the half that validates one.
 *
 * 🔴 Split out because of where it is consumed. The admin submission page
 * imports these two, and the admin app is a Vite BROWSER bundle: importing
 * them from `rate-breakdown.ts` dragged `MedusaError` — and with it
 * `@medusajs/framework/utils` and its Node built-ins — into the browser, where
 * the dashboard died on `util.inherits is not a function` before it rendered a
 * single pixel. Not the payout screen: the whole admin app, login included.
 *
 * So this file imports NOTHING, and must keep importing nothing. It is the
 * shared vocabulary for a partner's money, the same way `payment-line-source`
 * and `transfer-carrier-line` are, and it is shared precisely so the admin
 * screen and the partner screen cannot describe one breakdown two ways.
 */

/** One price band within a line: this many pieces, at this rate each. */
export type RateSlice = {
  quantity: number
  unit_amount: number
}

/**
 * The bands, in words: "3 × 850 + 1 × 1200".
 */
export const describeRateBreakdown = (
  slices: RateSlice[] | null | undefined
): string | null => {
  if (!Array.isArray(slices) || !slices.length) return null

  return slices
    .map((s) => `${Number(s.quantity)} × ${Number(s.unit_amount)}`)
    .join(" + ")
}

/**
 * A stored line's breakdown, if it has one worth showing.
 *
 * ⚠️ A single-band breakdown is deliberately dropped: it says exactly what
 * `quantity` and `unit_amount` already say, and rendering it twice invites a
 * reader to wonder which is authoritative.
 */
export const readRateBreakdown = (item: any): RateSlice[] | null => {
  const raw = item?.rate_breakdown
  if (!Array.isArray(raw) || raw.length < 2) return null

  const slices = raw
    .filter(
      (s) =>
        s &&
        Number.isFinite(Number(s.quantity)) &&
        Number.isFinite(Number(s.unit_amount))
    )
    .map((s) => ({
      quantity: Number(s.quantity),
      unit_amount: Number(s.unit_amount),
    }))

  return slices.length >= 2 ? slices : null
}
