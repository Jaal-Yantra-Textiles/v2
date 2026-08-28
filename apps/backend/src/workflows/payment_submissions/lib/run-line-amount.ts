/**
 * What a RUN-sourced payout line bills (#1612).
 *
 * A run-sourced line pays for one or more completed production runs directly,
 * rather than for a design. It exists because runs minted from a retail order's
 * fulfillment carry `design_id: null` and can never be expressed as a design
 * line — see the seven runs behind order #79.
 *
 * ## Why the amount is usually explicit
 *
 * `runPayableAmount` derives a run's value from `partner_cost_estimate` and the
 * ORDERED quantity. That works for a dispatched design run. It does not work
 * here: **all seven order-#79 runs carry `partner_cost_estimate: null`**, so the
 * derivation yields 0 for every one of them. The labour was real, agreed out of
 * band and already paid; the number simply is not on the run.
 *
 * So an explicit `amount` is the normal path for this source, and derivation is
 * the fallback for runs that do carry a cost.
 *
 * ## 🔴 Zero is refused, never written
 *
 * A derivation that finds nothing returns 0, and 0 is a number: it passes every
 * `!= null` check, sums cleanly into a total, and renders as a real payout of
 * nothing. That is how an estimator's "found nothing = 0" reached a storefront
 * till (#1564), and how a `=== null` guard was defeated by a 0 written for
 * "found nothing" (#1563).
 *
 * A line that cannot say what it bills is refused here, with a message naming
 * the runs, so an operator supplies the figure instead of a silent zero being
 * approved by someone reading a total.
 */

export type RunForLine = {
  id: string
  quantity?: number | null
  produced_quantity?: number | null
  partner_cost_estimate?: number | null
  cost_type?: string | null
}

export type ResolvedRunLine = {
  amount: number
  quantity: number
  /** Null when the total was typed rather than derived — there is no rate to show. */
  unit_amount: number | null
  cost_breakdown: Record<string, unknown>
}

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * PURE.
 *
 * `quantity` defaults to the total PRODUCED across the runs, not the ordered
 * total. A run-sourced line pays for delivered work, and the two differ: the
 * embroidered-jacket run was ordered 9 and produced 7, and billing the ordered
 * figure overpaid by two garments (#1596). Where produced is not recorded the
 * ordered quantity stands in, since something must.
 */
export function resolveRunLineAmount(input: {
  runs: RunForLine[]
  /** An explicit line TOTAL. Wins outright and is never multiplied. */
  amount?: number | null
  quantity?: number | null
  deriveAmount?: (run: RunForLine) => number
}): ResolvedRunLine {
  const runs = input.runs || []

  if (!runs.length) {
    throw new Error("A run-sourced line must name at least one production run.")
  }

  const producedTotal = runs.reduce(
    (sum, run) =>
      sum +
      (run.produced_quantity != null
        ? num(run.produced_quantity)
        : num(run.quantity)),
    0
  )

  const quantity =
    input.quantity != null && num(input.quantity) > 0
      ? num(input.quantity)
      : producedTotal > 0
        ? producedTotal
        : 1

  const explicit = input.amount
  const hasExplicit = explicit != null && Number.isFinite(Number(explicit))

  const amount = hasExplicit
    ? Math.round(Number(explicit) * 100) / 100
    : Math.round(
        runs.reduce((sum, run) => sum + (input.deriveAmount?.(run) ?? 0), 0) *
          100
      ) / 100

  if (!(amount > 0)) {
    throw new Error(
      `A run-sourced line must bill a positive amount. ` +
        `The runs it names (${runs.map((r) => r.id).join(", ")}) carry no cost ` +
        `to derive one from — send an explicit amount. ` +
        `Writing 0 would record a payout of nothing that reads as a real one.`
    )
  }

  return {
    amount,
    quantity,
    // A typed total carries no rate. Deriving one by dividing would invent a
    // per-unit figure nobody agreed to — the same reason a corrected line
    // clears `unit_amount` rather than back-computing it.
    unit_amount: hasExplicit
      ? null
      : quantity > 0
        ? Math.round((amount / quantity) * 100) / 100
        : null,
    cost_breakdown: {
      source: "production_runs",
      run_ids: runs.map((r) => r.id),
      basis: hasExplicit ? "explicit_total" : "derived_from_runs",
      produced_quantity: producedTotal,
    },
  }
}
