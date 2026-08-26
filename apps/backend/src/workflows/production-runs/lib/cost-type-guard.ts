/**
 * A cost figure without a `cost_type` is not a price — it is a number.
 *
 * ## Why this refuses instead of defaulting
 *
 * `production_run.cost_type` is `.default("total")` on the model, and every
 * reader treats an absent value as a total (`runPayableAmount`,
 * `runUnitCost`, `getActualProductionCostStep`). So a partner typing their
 * PER-PIECE rate into a completion form that did not make them choose stored a
 * per-piece figure labelled "total", and the payout billed it once: ₹850 for
 * nine garments, with nothing erroring and the number looking entirely
 * plausible. (#1554)
 *
 * The two readings differ by a factor of the run quantity. There is no safe
 * default for that — a default is a guess about money — so the amount and the
 * type travel together or the request is refused.
 *
 * ## What it deliberately does NOT do
 *
 * It does not require `cost_type` on its own. Sending `cost_type` with no
 * amount is how a correction re-labels an existing figure, and the ops
 * correction job relies on exactly that.
 */
export type CostTypeGuardInput = {
  partner_cost_estimate?: number | null
  cost_type?: string | null
}

/**
 * PURE: the refusal message for a cost sent without its type, or null when the
 * pair is acceptable.
 */
export const costTypeGuardMessage = (
  input: CostTypeGuardInput | null | undefined
): string | null => {
  const amount = Number(input?.partner_cost_estimate)
  const hasAmount = Number.isFinite(amount) && amount > 0
  if (!hasAmount) {
    return null
  }

  const type = String(input?.cost_type ?? "").trim()
  if (type === "per_unit" || type === "total") {
    return null
  }

  return (
    "cost_type is required whenever a cost is given: send 'per_unit' for a " +
    "rate per finished piece, or 'total' for the whole run. The two differ by " +
    "the run quantity, so there is no safe default — a per-piece rate stored " +
    "as a total is paid once."
  )
}
