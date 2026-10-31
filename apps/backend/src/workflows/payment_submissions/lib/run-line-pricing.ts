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
  /**
   * Whether a LIVE line already claimed part of this run (#1596/#1676).
   *
   * 🔴 It changes what an untouched total-priced row bills, and it has to.
   * `amount` is the price agreed for the WHOLE job, and this screen used to
   * drop such a run the moment anything claimed it — so "bill it again" was
   * never a state that could exist. Now that the remainder is offered, an
   * untouched row would default to the full agreed total a SECOND time, and
   * `assessRunClaims` would not stop it: that guard bounds UNITS (4 + 5 ≤ 9),
   * not money. ₹10,000 agreed, ₹20,000 paid, nothing refused.
   */
  alreadyPartlyBilled?: boolean | null
}

/**
 * PURE. Whether this row still bills an agreed TOTAL rather than a rate.
 *
 * Both halves matter: a derived rate that somebody has since overtyped is no
 * longer derived, and a genuine per-unit rate was never a total.
 */
export const runBillsVerbatimTotal = (
  input: Pick<
    RunLinePricingInput,
    "unit_is_derived" | "hasTypedRate" | "alreadyPartlyBilled"
  >
): boolean =>
  !input.hasTypedRate && !!input.unit_is_derived && !input.alreadyPartlyBilled

/**
 * PURE. Whether this row can state no price of its own until somebody types one.
 *
 * The one case: an agreed TOTAL, on a run part of which has already been
 * billed. The total was the price for the whole job and it has been paid
 * against once; there is no arithmetic that yields the remainder's worth.
 * Dividing the total by the ordered quantity and re-multiplying is exactly the
 * re-pricing that billed ₹7,777.77 on a ₹10,000 job (#1679), and re-billing the
 * total is a straight double payment.
 *
 * So the row bills NOTHING and says so, and the screen's existing zero-amount
 * guard refuses to submit until an operator states what the rest is worth.
 * That is the same rule this screen already applies to a run carrying no agreed
 * rate: an absent figure is never a price, and somebody who knows types it.
 */
export const runNeedsTypedPrice = (
  input: Pick<
    RunLinePricingInput,
    "unit_is_derived" | "hasTypedRate" | "alreadyPartlyBilled"
  >
): boolean =>
  !input.hasTypedRate && !!input.unit_is_derived && !!input.alreadyPartlyBilled

/** PURE. What this run bills. */
export const runLineAmount = (input: RunLinePricingInput): number => {
  /**
   * 🔴 BEFORE the verbatim branch and before the multiplication — both of the
   * other answers are wrong here. Re-billing the total double-pays; multiplying
   * the derived rate re-prices a job nobody re-negotiated.
   */
  if (runNeedsTypedPrice(input)) {
    return 0
  }
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

/**
 * The fields of a `payable-runs` row that decide its UNTOUCHED line.
 *
 * Structural rather than the route's type, so the dashboard (a Vite bundle) and
 * the server can both call it without either importing the other's types.
 */
export type PayableRunLike = {
  billing_status: string
  payable_quantity: number
  billable_remaining: number | null
  unit_amount: number
  unit_is_derived?: boolean | null
  amount: number
  /** The live claim on this run, when one exists. */
  billed?: { claimed_quantity?: number | null } | null
}

/**
 * PURE. Units an untouched row bills.
 *
 * On a partly-billed run that is the units MADE and not yet billed, capped by
 * what the write guard has left (`billable_remaining`).
 *
 * 🔴 #2480. This used to offer `payable_quantity` whenever the remainder was
 * not smaller than it — and the remainder is measured against the ORDERED
 * ceiling. A run ordered 9, made 4 and billed for those 4 reads "5 left", and
 * the screen offered the 4 made units AGAIN: ₹4,800 more for garments already
 * billed. Founder rule: a partner is paid for what they made, so the default
 * is made − already billed, which is 0 until more output is recorded.
 *
 * `billable_remaining` is null when there is no arithmetic behind it (a claim
 * took the run whole, or the run has no agreed quantity, #1676). That is not a
 * remainder of zero, so only the made-but-unbilled bound applies then.
 */
export const defaultRunQuantity = (run: PayableRunLike): number => {
  if (run.billing_status !== "partly_billed") return run.payable_quantity

  const claimed = Number(run.billed?.claimed_quantity)
  const unbilledMade = Number.isFinite(claimed)
    ? Math.max(0, run.payable_quantity - claimed)
    : run.payable_quantity

  const remaining = run.billable_remaining
  return remaining != null && remaining >= 0
    ? Math.min(unbilledMade, remaining)
    : unbilledMade
}

/**
 * PURE. The rate an untouched row shows — none on a partly-billed TOTAL run,
 * whose `unit_amount` is display-only arithmetic (#1679).
 */
export const defaultRunRate = (run: PayableRunLike): number =>
  runNeedsTypedPrice({
    unit_is_derived: run.unit_is_derived,
    hasTypedRate: false,
    alreadyPartlyBilled: run.billing_status === "partly_billed",
  })
    ? 0
    : run.unit_amount

/**
 * PURE. What the create screen bills for this run if nobody types anything.
 *
 * 🔑 The one figure "Who to pay" (#2480) sums per partner. It goes through the
 * same `runLineAmount` the create screen does, so the total a founder reads on
 * the summary is the total the payout is written with.
 */
export const defaultRunLineAmount = (run: PayableRunLike): number =>
  runLineAmount({
    quantity: defaultRunQuantity(run),
    rate: defaultRunRate(run),
    amount: run.amount,
    unit_is_derived: run.unit_is_derived,
    hasTypedRate: false,
    alreadyPartlyBilled: run.billing_status === "partly_billed",
  })
