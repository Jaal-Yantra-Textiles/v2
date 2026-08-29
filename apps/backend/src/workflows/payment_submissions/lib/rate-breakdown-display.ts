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

/**
 * Group priced work into the bands a line records (#1596).
 *
 * ## Why this is the WRITER's missing half
 *
 * The bands rendered from day one and nothing could produce them. Both create
 * screens hit the mixed-rate case and threw the structure away: two runs of one
 * design at ₹850 and ₹1,200 collapsed into a single typed TOTAL, and the line
 * came out saying ₹3,750 with a null rate and no account of how it got there.
 * The total was right and the explanation was gone — which is the whole of what
 * #1596 asks for.
 *
 * Runs at the SAME rate merge into one band: three separate ₹850 runs are "3 ×
 * 850", not three bands saying the same thing. Bands come back ordered by rate
 * so the same selection always sends the same payload — a set's iteration order
 * is insertion order, and two admins picking the same runs in a different order
 * would otherwise write two different-looking breakdowns of one agreement.
 *
 * 🔴 Returns null below two distinct rates, matching the validator's `.min(2)`
 * and `readRateBreakdown`'s floor. One rate is an ordinary priced line and
 * belongs in `quantity` + `unit_amount`, where every existing reader already
 * looks; sending it here would be a second spelling of a fact that has one.
 * Zero and negative figures are dropped — the validator refuses them, so a
 * screen that sends them turns a mistyped box into a 400 for the whole
 * submission rather than one skipped run.
 */
export const groupIntoRateBands = (
  entries: Array<{ quantity: number; unit_amount: number }> | null | undefined
): RateSlice[] | null => {
  const byRate = new Map<number, number>()

  for (const entry of entries || []) {
    const quantity = Number(entry?.quantity)
    const rate = Number(entry?.unit_amount)
    if (!Number.isFinite(quantity) || quantity <= 0) continue
    if (!Number.isFinite(rate) || rate <= 0) continue
    byRate.set(rate, (byRate.get(rate) || 0) + quantity)
  }

  if (byRate.size < 2) return null

  return [...byRate.entries()]
    .sort(([a], [b]) => a - b)
    .map(([unit_amount, quantity]) => ({
      // Guard the float: 0.1 + 0.2 pieces must not reach the validator as
      // 0.30000000000000004 and read as a quantity nobody typed.
      quantity: Math.round(quantity * 100) / 100,
      unit_amount,
    }))
}
