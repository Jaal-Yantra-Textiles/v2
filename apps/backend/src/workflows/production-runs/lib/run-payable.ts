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
