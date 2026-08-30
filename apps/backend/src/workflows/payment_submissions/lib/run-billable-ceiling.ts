/**
 * How many units of a run may be billed IN TOTAL.
 *
 * ## Why this is its own function
 *
 * The ceiling was the run's ORDERED quantity, read in three separate places —
 * `listRunOrderedQuantities` (submit + update guards), `create-payment-submission`
 * step 6, and `runBillableRemaining` on the payable-runs screen. Three readers
 * of one rule is how a fix lands on two of them (#1662, #1616). Short-close
 * changes that rule, so it gets one home first.
 *
 * ## The rule
 *
 * Ordered quantity, until somebody says no more will be made. A run ordered for
 * 9 and completed at 7 keeps 2 units billable on purpose: `produced_quantity`
 * is captured at completion and a run can legitimately produce more afterwards
 * — that is what the audited correction route exists for. Inferring the close
 * from `produced < ordered` would refuse a correction the system is built to
 * accept.
 *
 * Once short-closed, the ceiling is what was PRODUCED.
 *
 * 🔴 Two things it deliberately does NOT do:
 *
 * 1. It never returns a ceiling BELOW what has already been claimed. Closing a
 *    run at 4 that was legitimately billed to 7 (ordered 9) cannot un-bill
 *    those 3 units — no clawback lives here. The caller clamps its remainder at
 *    zero; this function reports the honest ceiling and lets `assessRunClaims`
 *    refuse anything further.
 * 2. It never reduces on missing data. A short-closed run whose
 *    `produced_quantity` cannot be read falls back to the ordered quantity: an
 *    absent number must not quietly cost a partner their claim, which is the
 *    mirror of the rule everywhere else in this module — absence is never
 *    permission, and it is never a penalty either.
 */

export type RunCeilingInput = {
  /** Ordered quantity — `production_runs.quantity`. */
  quantity?: number | string | null
  produced_quantity?: number | string | null
  short_closed_at?: Date | string | null
}

const finitePositive = (value: unknown): number | null => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * PURE. The total units billable for a run, or null when no ceiling can be
 * read at all — which every guard treats as a refusal, not as room.
 */
export const runBillableCeiling = (run: RunCeilingInput | null | undefined): number | null => {
  if (!run) {
    return null
  }

  const ordered = finitePositive(run.quantity)

  if (!run.short_closed_at) {
    return ordered
  }

  const produced = finitePositive(run.produced_quantity)
  if (produced == null) {
    // Closed, but with no readable output figure. Do not invent a reduction.
    return ordered
  }

  // A close can only ever LOWER the ceiling. If produced somehow exceeds what
  // was ordered, the ordered quantity is still what was agreed to be paid for.
  return ordered == null ? produced : Math.min(ordered, produced)
}

/** Whether a run has been declared finished-for-good. */
export const isShortClosed = (run: RunCeilingInput | null | undefined): boolean =>
  !!run?.short_closed_at
