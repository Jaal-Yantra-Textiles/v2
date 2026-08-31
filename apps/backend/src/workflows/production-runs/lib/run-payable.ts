// What we owe a partner for a completed run, and whether that run should turn
// into a payment submission at all.
//
// `partner_cost_estimate` is stored VERBATIM as the partner typed it, paired
// with `cost_type` — a "per_unit" value is per-unit and a "total" value is a
// total (#456). Every reader multiplies for itself; this is that multiplication,
// in one place, for the payout path.
//
// The multiplier is the ORDERED quantity, not the produced one: partner payout
// bills what was ordered (see the partner cost summary + the unified-order
// dual-write, which both derive the unit price from `run.quantity`). Correcting
// a partner's output figure therefore does NOT move the money — deliberately.

import { isProvenanceRun } from "../../consumption-logs/lib/reconcile-production-consumption"

export type RunForPayout = {
  id?: string
  design_id?: string | null
  partner_id?: string | null
  status?: string | null
  quantity?: number | null
  partner_cost_estimate?: number | null
  cost_type?: "per_unit" | "total" | null
  /**
   * Read ONLY to answer "was this run minted by a retail fulfilment" (#1606).
   * ⚠️ Every caller must actually FETCH it — a guard reading a field the query
   * never asked for is dead code that types perfectly.
   */
  metadata?: Record<string, any> | null
}

/**
 * The payable total for a run, or 0 when it has no usable cost.
 */
export const runPayableAmount = (run: RunForPayout | null | undefined): number => {
  const cost = Number(run?.partner_cost_estimate)
  if (!Number.isFinite(cost) || cost <= 0) {
    return 0
  }

  if (run?.cost_type !== "per_unit") {
    return cost
  }

  const ordered = Number(run?.quantity)
  const units = Number.isFinite(ordered) && ordered > 0 ? ordered : 1
  // Money — keep it to two decimals rather than trailing float dust.
  return Math.round(cost * units * 100) / 100
}

/**
 * The PER FINISHED UNIT cost of a run, or 0 when it has no usable cost.
 *
 * The inverse of `runPayableAmount`, and the figure `design.production_cost` /
 * `estimated_cost` are supposed to hold — `workflows/designs/estimate-design-cost.ts`
 * divides a run total back to per-unit for exactly that reason, and its own
 * input docs say "per finished unit".
 *
 * 🔑 `"per_unit"` is the ONLY value that means per-unit. Everything else,
 * **including an absent `cost_type`**, is read as a total. That is the
 * convention `runPayableAmount` and `getActualProductionCostStep` already use;
 * a second interpretation here would let the design disagree with the estimator
 * about what the same run cost.
 */
export const runUnitCost = (run: RunForPayout | null | undefined): number => {
  const cost = Number(run?.partner_cost_estimate)
  if (!Number.isFinite(cost) || cost <= 0) {
    return 0
  }

  if (run?.cost_type === "per_unit") {
    return cost
  }

  const ordered = Number(run?.quantity)
  const units = Number.isFinite(ordered) && ordered > 0 ? ordered : 1
  return Math.round((cost / units) * 100) / 100
}

/**
 * What `payable-runs` OFFERS for one run — the figure an operator reads on the
 * screen and then acts on.
 *
 * 🔴 Extracted because the offer screen and the create path were two different
 * pricers over one run (#1616). `payable-runs` offered ₹810 for the Princess
 * Highway run; creating the submission for that exact run, naming it in
 * `production_run_ids`, wrote ₹1,056.40 — the DESIGN's `estimated_cost`, +30%.
 * A figure an operator reads is not the figure that gets written, and the
 * created Draft looks authoritative either way.
 *
 * ⚠️ The quantity is PRODUCED where output was recorded, ordered otherwise,
 * and never above what was ordered (#1676) —
 * which is deliberately NOT `runPayableAmount`'s multiplier. That function
 * bills the ordered quantity (#456, and the unified-order dual-write depends on
 * it); this one bills what the screen offers. The two answer different
 * questions and the difference is stated in `quantity_basis` rather than
 * papered over.
 */
export type RunPayableOffer = {
  /**
   * The rate per finished unit.
   *
   * ⚠️ For a `total` run this is DERIVED for display — `unit_is_derived` says
   * so — and `unit_amount * quantity` deliberately does NOT reproduce `amount`.
   * Read `amount` for the money; read this only to show a rate.
   */
  unit_amount: number
  /** Whether `unit_amount` was computed rather than agreed. */
  unit_is_derived: boolean
  /**
   * Units billed — produced where recorded, else ordered; never below 1 and
   * never above the ordered quantity, which is the ceiling the write guard
   * enforces (#1676).
   */
  quantity: number
  quantity_basis: "produced" | "ordered"
  /**
   * What is owed.
   *
   * 🔴 For `cost_type: "total"` this is the agreed total VERBATIM. It is not
   * `unit_amount * quantity`: dividing a total by the ordered quantity and
   * re-multiplying by the produced one silently RE-PRICES the job. On a real
   * run — ₹10,000 agreed, 9 ordered, 7 made — that arithmetic billed ₹7,777.77,
   * a 22% cut nobody decided, and even when ordered equalled produced it lost a
   * paisa to rounding (₹9,999.99). The total was the price for the job; a
   * shortfall in output is a conversation, not an automatic discount. (#1596)
   */
  amount: number
  /**
   * Whether the RUN carries an agreed rate.
   *
   * ⚠️ NOT "can this be paid". A run with no agreed rate is not a zero-value
   * payout and it is not unpayable — it is a run whose price was never written
   * down, and someone who knows what was agreed must still be able to type it.
   */
  payable: boolean
}

export const runPayableOffer = (
  run: RunForPayout & { produced_quantity?: number | null }
): RunPayableOffer => {
  const produced = Number(run?.produced_quantity)
  const hasProduced = Number.isFinite(produced) && produced > 0
  const ordered = Number(run?.quantity)
  const hasOrdered = Number.isFinite(ordered) && ordered > 0
  const offered = hasProduced ? produced : hasOrdered ? ordered : 1
  /**
   * 🔴 Never more than was ORDERED (#1676).
   *
   * The offer is what an operator reads and then acts on, and from #1676 the
   * write guard refuses a claim above the run's agreed quantity — including
   * the run's very first claim. Offering the produced figure unclamped would
   * put a number on the screen that `create` then rejects, which is the exact
   * defect `runPayableOffer` was extracted to prevent (#1616): a figure an
   * operator reads must be the figure that gets written.
   *
   * A run that genuinely overproduced is not being cheated silently — the row
   * still prints `produced_quantity` beside this, and the honest routes are to
   * correct the ordered quantity (an audited edit) or to run open-ended. A run
   * with NO agreed quantity has no `ordered` to clamp against, so it offers
   * what was made.
   */
  const quantity = hasOrdered ? Math.min(offered, ordered) : offered
  /** Honest about the clamp: a produced figure cut back to ordered IS ordered. */
  const quantity_basis: "produced" | "ordered" =
    hasProduced && quantity === produced ? "produced" : "ordered"

  const agreed = Number(run?.partner_cost_estimate)
  const hasAgreed = Number.isFinite(agreed) && agreed > 0

  /**
   * 🔑 `"per_unit"` is the ONLY value meaning per-unit; everything else,
   * including an absent `cost_type`, is a TOTAL. Same convention as
   * `runPayableAmount` and `runUnitCost`.
   */
  const isPerUnit = run?.cost_type === "per_unit"

  if (!hasAgreed) {
    return {
      unit_amount: 0,
      unit_is_derived: false,
      quantity,
      quantity_basis,
      amount: 0,
      payable: false,
    }
  }

  if (isPerUnit) {
    // A rate the partner typed. Multiplying it by what they made is the whole
    // meaning of "per unit".
    return {
      unit_amount: agreed,
      unit_is_derived: false,
      quantity,
      quantity_basis,
      amount: Math.round(agreed * quantity * 100) / 100,
      payable: true,
    }
  }

  /**
   * A TOTAL. The agreed figure stands verbatim — see `amount` above for why
   * dividing and re-multiplying it is a silent re-pricing. The per-unit figure
   * is derived purely so a screen can show a rate, and is flagged as such
   * because `unit_amount * quantity` will not reproduce `amount`.
   */
  return {
    unit_amount: Math.round((agreed / quantity) * 100) / 100,
    unit_is_derived: true,
    quantity,
    quantity_basis,
    amount: agreed,
    payable: true,
  }
}

/**
 * What a payout line naming one or more runs bills, priced from THE RUNS.
 *
 * Returns `null` when no claimed run carries an agreed rate — the caller then
 * falls back to whatever it did before. Pricing a rate-less run from the design
 * is the silent substitution `payable-runs` already refuses ("a suggestion,
 * never a price"), but refusing outright here would block the documented flow
 * of billing a run whose price was agreed off-system, so the fallback stays and
 * says which basis it used.
 *
 * 🔴 `unit_amount` is null when the claimed runs carry DIFFERENT rates. There
 * is no single rate behind such a line, and dividing the total back out would
 * invent one — the same reason a typed total records no rate.
 */
export const resolveRunLinePrice = (
  runs: Array<RunForPayout & { produced_quantity?: number | null }>
): { amount: number; quantity: number; unit_amount: number | null } | null => {
  const offers = (runs || []).map(runPayableOffer).filter((o) => o.payable)
  if (!offers.length) return null

  const amount =
    Math.round(offers.reduce((acc, o) => acc + o.amount, 0) * 100) / 100
  const quantity = offers.reduce((acc, o) => acc + o.quantity, 0)

  /**
   * 🔴 A DERIVED rate is not recorded on the line.
   *
   * `payment_submission_item.unit_amount` means "the rate the total was built
   * from" — and for a `total` run the total was not built from a rate, it WAS
   * the agreed figure. Writing 1428.57 there would state a price nobody agreed
   * to, and a reader multiplying it by 7 would get ₹9,999.99 against a line of
   * ₹10,000. Null is the honest value; the screen can still show a derived rate
   * from `runPayableOffer` without it being written down as fact. (#1596)
   */
  const rates = new Set(offers.map((o) => o.unit_amount))
  const anyDerived = offers.some((o) => o.unit_is_derived)
  const unit_amount = !anyDerived && rates.size === 1 ? offers[0].unit_amount : null

  return { amount, quantity, unit_amount }
}

export type PayoutEligibility =
  | {
      eligible: true
      design_id: string
      partner_id: string
      /** What the run is worth in total — already multiplied. */
      amount: number
      /** Units the total covers, and the rate per unit, so a payment line can
       *  say "9 x 850" instead of a bare 7650. Both are derived from the same
       *  figures `amount` is, so they always reconcile. */
      quantity: number
      unit_amount: number
    }
  | { eligible: false; reason: string }

/**
 * Whether a completed run can be turned into a draft payment submission.
 *
 * Deliberately strict and silent: this runs off an event for every completion,
 * so anything it can't bill confidently is skipped with a reason rather than
 * guessed at. In particular a run with no cost entered is NOT a zero-value
 * submission — it's a run whose price hasn't been agreed yet.
 */
export const assessRunPayout = (
  run: RunForPayout | null | undefined
): PayoutEligibility => {
  if (!run) {
    return { eligible: false, reason: "run_not_found" }
  }
  if (String(run.status || "") !== "completed") {
    return { eligible: false, reason: "run_not_completed" }
  }
  if (!run.design_id) {
    return { eligible: false, reason: "no_design" }
  }
  if (!run.partner_id) {
    return { eligible: false, reason: "no_partner" }
  }

  /**
   * A run born from a retail fulfilment shipped from stock: no shop-floor
   * work, no consumption, no labour to pay for. Counting it invents labour,
   * exactly as `reconcileDesigns` refuses to let it invent material (#1123).
   *
   * Defensive today rather than load-bearing: `complete-provenance-run`
   * deliberately emits no `production_run.completed`, so no auto-draft
   * currently reaches this for one. If that ever changes, this is what stops a
   * phantom payout appearing with no guard in the way. #1606
   */
  if (isProvenanceRun(run)) {
    return { eligible: false, reason: "provenance_run" }
  }

  const amount = runPayableAmount(run)
  if (amount <= 0) {
    return { eligible: false, reason: "no_cost" }
  }

  // The ordered quantity, matching runPayableAmount's multiplier exactly — a
  // second, differently-derived quantity here would let the breakdown disagree
  // with the total it is supposed to explain.
  const ordered = Number(run.quantity)
  const quantity = Number.isFinite(ordered) && ordered > 0 ? ordered : 1

  // For a "total" cost_type the rate is the total divided back out; for
  // "per_unit" it is what the partner typed. Either way unit x quantity
  // reproduces `amount`.
  const unit_amount =
    run.cost_type === "per_unit"
      ? Number(run.partner_cost_estimate)
      : Math.round((amount / quantity) * 100) / 100

  return {
    eligible: true,
    design_id: String(run.design_id),
    partner_id: String(run.partner_id),
    amount,
    quantity,
    unit_amount,
  }
}
