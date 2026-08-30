/**
 * What one payable run bills, and on which channel it must be SENT.
 *
 * ## The rule
 *
 * A run carries either a rate or a total, and `cost_type` says which. A
 * `per_unit` run was agreed at so much per piece, so its amount is
 * `quantity × rate` and moving the quantity moves the money — that is the whole
 * meaning of per-unit.
 *
 * A `total` run was agreed at a price for the JOB. `payable-runs` still sends a
 * `unit_amount` for it, derived as `total / quantity` purely so a screen can
 * show a rate, and flags it `unit_is_derived` for exactly this reason:
 * multiplying it back out does NOT reproduce the total. On a real run — ₹10,000
 * agreed, 9 ordered, 7 made — that arithmetic bills ₹7,777.77, a 22% cut nobody
 * decided, and even when ordered equals produced it loses a paisa to rounding
 * (₹9,999.99). 97 of 100 production runs are priced this way.
 *
 * So an untouched total-priced run bills its agreed figure VERBATIM, and the
 * quantity does not move it.
 *
 * ## Typing a rate is the way out
 *
 * A human who has decided a per-unit price outranks a stored figure — that is
 * already `create`'s documented precedence. Once someone types a rate, the row
 * is per-piece by their decision and multiplies from then on.
 *
 * ## Why this is its own file
 *
 * It decides displayed money AND which request field carries it, and those two
 * must agree. `create` prices in a fixed order: a typed line total wins
 * outright, then a typed RATE, and only then the runs via `runPayableOffer`.
 * Sending a derived rate as `unit_amounts` therefore OUTRANKS the one true
 * pricer and makes the server multiply a figure that was never per-piece — the
 * screen would show one number and the submission would be written with
 * another, which is #1616 exactly.
 */

export type RunLinePricingInput = {
  /** `production_runs.quantity`-derived units being billed. */
  quantity: number
  /** The rate in the box: the run's own, or one an operator typed. */
  rate: number
  /** What `payable-runs` says is owed. For a total run, the agreed total. */
  amount: number
  /** Whether `rate` was computed rather than agreed. */
  unit_is_derived?: boolean | null
  /** Whether a human has typed a rate for this run. */
  hasTypedRate: boolean
}

/**
 * PURE. Whether this row still bills an agreed TOTAL rather than a rate.
 *
 * Both halves matter: a derived rate that somebody has since overtyped is no
 * longer derived, and a genuine per-unit rate was never a total.
 */
export const runBillsVerbatimTotal = (
  input: Pick<RunLinePricingInput, "unit_is_derived" | "hasTypedRate">
): boolean => !input.hasTypedRate && !!input.unit_is_derived

/** PURE. What this run bills. */
export const runLineAmount = (input: RunLinePricingInput): number => {
  if (runBillsVerbatimTotal(input)) {
    // Verbatim. Not rounded, not re-derived, not multiplied.
    return input.amount
  }
  const quantity = Number(input.quantity)
  const rate = Number(input.rate)
  if (!Number.isFinite(quantity) || !Number.isFinite(rate)) {
    return 0
  }
  return Math.round(quantity * rate * 100) / 100
}
