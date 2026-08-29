/**
 * Per-piece prices on ONE payout line (#1596).
 *
 * ## The gap this closes
 *
 * A partner may legitimately charge different prices for different pieces of a
 * single run — one needs extra embroidery, one is a size that costs more, one
 * is a re-make. A production run carries exactly one rate
 * (`partner_cost_estimate` + `cost_type`), so "3 at ₹850 and 1 at ₹1,200" has
 * had nowhere to live. The two available answers were both bad: average it —
 * the total right, every "9 × ₹X" display a fiction — or split the work into
 * extra runs purely to express pricing, which distorts run counts and dispatch
 * state.
 *
 * ## Why it lives on the LINE, not in a per-piece rate table
 *
 * 1 of 21 production payment lines on prod is mixed-price. A table is a schema
 * for the exception, and every reader of `quantity` / `unit_amount` would have
 * to learn about it. A breakdown recorded on the line leaves the common case
 * byte-for-byte unchanged and makes the rare one expressible.
 *
 * ## 🔴 The invariant
 *
 * `amount` remains the authoritative total — nothing downstream re-derives it,
 * because re-deriving a total underpaid a partner by 22% (#1596/#1637). The
 * breakdown EXPLAINS that total; it never competes with it. And a mixed-price
 * line's `unit_amount` stays NULL: the model already says a reader wanting
 * "9 × 850" must read `unit_amount` rather than dividing, and inventing an
 * average here would present a rate nobody agreed to as though they had.
 */
import { MedusaError } from "@medusajs/framework/utils"

/** One price band within a line: this many pieces, at this rate each. */
export type RateSlice = {
  quantity: number
  unit_amount: number
}

export type FoldedRateBreakdown = {
  /** Total pieces across every band. */
  quantity: number
  /** What the bands sum to, rounded to the cent. */
  amount: number
  /**
   * The one rate, when every band agrees — otherwise NULL.
   *
   * 🔴 Never an average. A single-band breakdown is just an ordinary priced
   * line and keeps its rate; the moment two bands disagree there is no rate to
   * state, and null is the honest answer.
   */
  unit_amount: number | null
}

const cents = (value: number): number => Math.round(value * 100) / 100

/** Sum a breakdown into the three figures a line records. */
export const foldRateBreakdown = (slices: RateSlice[]): FoldedRateBreakdown => {
  const quantity = slices.reduce((acc, s) => acc + Number(s.quantity), 0)
  const amount = cents(
    slices.reduce((acc, s) => acc + Number(s.quantity) * Number(s.unit_amount), 0)
  )

  const rates = new Set(slices.map((s) => Number(s.unit_amount)))

  return {
    quantity: cents(quantity),
    amount,
    unit_amount: rates.size === 1 ? [...rates][0] : null,
  }
}

/**
 * Refuse a breakdown that contradicts a total the same request also states.
 *
 * 🔴 Two spellings of one fact must agree or one of them is wrong, and the
 * caller — not this code — knows which. Picking a winner silently is the
 * #1557 shape: the money would be decided by which branch happened to run
 * first, and the disagreement would surface weeks later as an underpayment.
 *
 * A tolerance of one cent, because the breakdown is multiplied and rounded
 * while a typed total is not.
 */
export const assertBreakdownMatchesTotal = (
  designId: string,
  folded: FoldedRateBreakdown,
  total: number | null | undefined
): void => {
  if (total == null || !Number.isFinite(Number(total))) return

  const typed = cents(Number(total))
  /**
   * ⚠️ Compared in whole cents. `Math.abs(3750.01 - 3750) <= 0.01` is FALSE in
   * binary floating point — the difference lands at 0.010000000000218, and a
   * caller who typed the total the breakdown sums to would have been refused.
   */
  if (Math.round(Math.abs(typed - folded.amount) * 100) <= 1) return

  throw new MedusaError(
    MedusaError.Types.INVALID_DATA,
    `rate_breakdown for ${designId} sums to ${folded.amount} but cost_overrides says ${typed}. Both describe the same line total — send one, or make them agree.`
  )
}

/**
 * The bands, in words: "3 × 850 + 1 × 1200".
 *
 * PURE and shared, so the admin screen and the partner screen cannot describe
 * one partner's money two different ways.
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
