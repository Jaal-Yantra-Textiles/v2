/**
 * Order-backed production runs, grouped into payable units (#1612, #1598).
 *
 * ## What was wrong
 *
 * `payable-runs` began with `filter((r) => !!r.design_id)` and everything after
 * it was design-keyed, so a run without a design simply ceased to exist there —
 * no row, no exclusion, no count. The seven runs behind retail order #79 are
 * exactly that: minted by `order.fulfillment_created` with `design_id: null`,
 * completed and delivered, and never offered for payment by any screen.
 *
 * That contradicted the same file's rule for provenance runs, which are
 * REPORTED rather than dropped because "a screen that simply omits the row
 * teaches nobody why the work vanished". A silent drop is worse than an
 * exclusion — an exclusion at least says the work exists.
 *
 * ## Grouped by order, because that is the unit the money is agreed in
 *
 * Order #79 is one payment of ₹8,974, not seven of ₹1,282. The group carries
 * every run id so a caller can send it as a single `run_lines` entry.
 */

export type OrderBackedRun = {
  id: string
  order_id?: string | null
  quantity?: number | null
  produced_quantity?: number | null
  completed_at?: string | Date | null
}

export type RunClaimInfo = {
  submission_id: string
  status: string
}

export type OrderRunGroup = {
  order_id: string
  run_ids: string[]
  run_count: number
  produced_quantity: number
  completed_at: string | null
  billing_status: "clear" | "billed" | "partly_billed"
  claimed_by: string | null
  /** Always null — see the note in `groupOrderBackedRuns`. */
  amount: null
  amount_reason: string
}

const AMOUNT_REASON =
  "Runs carry no partner_cost_estimate — the payout amount must be stated by an operator."

/**
 * PURE.
 *
 * ⚠️ No amount is ever offered. These runs carry `partner_cost_estimate: null`
 * — all seven of order #79's do — so any figure computed here would be a 0
 * dressed as a price, and 0 passes every `!= null` check downstream (#1563,
 * #1564). The rate was agreed out of band; an operator must state it, and
 * `create` refuses a zero-value run line for the same reason.
 */
export function groupOrderBackedRuns(
  runs: OrderBackedRun[],
  claims: Map<string, RunClaimInfo>
): OrderRunGroup[] {
  const groups = new Map<string, OrderBackedRun[]>()

  for (const run of runs || []) {
    if (!run?.order_id) continue
    const orderId = String(run.order_id)
    groups.set(orderId, [...(groups.get(orderId) || []), run])
  }

  return [...groups.entries()].map(([orderId, groupRuns]) => {
    const claimed = groupRuns
      .map((run) => claims.get(String(run.id)))
      .filter(Boolean) as RunClaimInfo[]

    const produced = groupRuns.reduce(
      (sum, run) =>
        sum +
        (run.produced_quantity != null
          ? Number(run.produced_quantity ?? 0)
          : Number(run.quantity ?? 0)),
      0
    )

    const completedAts = groupRuns
      .map((run) =>
        run.completed_at
          ? new Date(run.completed_at).toISOString()
          : null
      )
      .filter(Boolean)
      .sort() as string[]

    return {
      order_id: orderId,
      run_ids: groupRuns.map((run) => String(run.id)),
      run_count: groupRuns.length,
      produced_quantity: produced,
      completed_at: completedAts.length
        ? completedAts[completedAts.length - 1]
        : null,
      /**
       * 🔴 `partly_billed` is its own answer, not a rounding of the other two.
       * A group where some runs are claimed and some are not cannot be paid as
       * a whole without double-paying part of it, and cannot be skipped without
       * underpaying the rest. Collapsing it into `billed` hides money owed;
       * collapsing it into `clear` invites a double payment. A human has to
       * split it, and the status has to say so.
       */
      billing_status:
        claimed.length === 0
          ? "clear"
          : claimed.length === groupRuns.length
            ? "billed"
            : "partly_billed",
      claimed_by: claimed.length ? claimed[0].submission_id : null,
      amount: null,
      amount_reason: AMOUNT_REASON,
    }
  })
}
