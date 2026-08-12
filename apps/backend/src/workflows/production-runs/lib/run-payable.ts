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

export type RunForPayout = {
  id?: string
  design_id?: string | null
  partner_id?: string | null
  status?: string | null
  quantity?: number | null
  partner_cost_estimate?: number | null
  cost_type?: "per_unit" | "total" | null
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

export type PayoutEligibility =
  | { eligible: true; design_id: string; partner_id: string; amount: number }
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

  const amount = runPayableAmount(run)
  if (amount <= 0) {
    return { eligible: false, reason: "no_cost" }
  }

  return {
    eligible: true,
    design_id: String(run.design_id),
    partner_id: String(run.partner_id),
    amount,
  }
}
