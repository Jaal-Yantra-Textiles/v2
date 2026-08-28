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
 * ⚠️ The quantity is PRODUCED where output was recorded, ordered otherwise —
 * which is deliberately NOT `runPayableAmount`'s multiplier. That function
 * bills the ordered quantity (#456, and the unified-order dual-write depends on
 * it); this one bills what the screen offers. The two answer different
 * questions and the difference is stated in `quantity_basis` rather than
 * papered over.
 */
export type RunPayableOffer = {
  /** The agreed rate per finished unit, or 0 when the run carries none. */
  unit_amount: number
  /** Units billed — produced where recorded, else ordered, never below 1. */
  quantity: number
  quantity_basis: "produced" | "ordered"
  /** unit_amount x quantity, to two decimals. */
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
  // `runUnitCost` divides a "total" cost_type back out and takes a "per_unit"
  // one verbatim — one place, one convention.
  const unit_amount = runUnitCost(run)

  const produced = Number(run?.produced_quantity)
  const hasProduced = Number.isFinite(produced) && produced > 0
  const ordered = Number(run?.quantity)
  const quantity = hasProduced
    ? produced
    : Number.isFinite(ordered) && ordered > 0
      ? ordered
      : 1

  return {
    unit_amount,
    quantity,
    quantity_basis: hasProduced ? "produced" : "ordered",
    amount: Math.round(unit_amount * quantity * 100) / 100,
    payable: unit_amount > 0,
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

  const rates = new Set(offers.map((o) => o.unit_amount))
  const unit_amount = rates.size === 1 ? offers[0].unit_amount : null

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
