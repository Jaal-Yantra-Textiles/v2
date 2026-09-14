/**
 * A partner's OWN production is their expense, not our payable (#2028 item 5).
 *
 * When a partner raises a run on their own design through the partner app,
 * `metadata.source: "partner.self_serve"` is stamped on it. The cost on that run
 * is what THEY will pay their own maker. The platform did not commission the
 * work and cannot settle it — a partner cannot be both payer and payee, so
 * there is no payout to make. #2040 already stopped it auto-drafting.
 *
 * 🔑 But it must still be VISIBLE. Founder's framing (2026-09-13): it shows up
 * in admin as the partner's own payment, filterable, with the money on it — an
 * EXPENSE we can see, not a payable we owe.
 *
 * That is why this is its own bucket rather than another `excluded_runs` reason.
 * Every existing exclusion — `provenance_run` (#1606), `superseded_run` (#2026),
 * `no_design_and_no_order` — names a defect or an artefact: work that was
 * double-counted, or never happened in that run. A self-serve run is real work
 * with a real cost. Filing it under "excluded" would say something false about
 * it, and would bury a number the partner's own books need.
 *
 * PURE, so the arithmetic can be tested without a database behind it — and so
 * the admin route and the partner route cannot drift, which is the failure this
 * whole endpoint pair keeps having.
 */

import {
  isPartnerSelfServeRun,
  runPayableOffer,
  type RunForPayout,
} from "../../production-runs/lib/run-payable"

export type PartnerExpenseRun = {
  run_id: string
  design_id: string | null
  design_name: string | null
  completed_at: string | null
  /** Units the expense covers, on the same basis the payable screens use. */
  quantity: number
  quantity_basis: "produced" | "ordered"
  unit_amount: number
  unit_is_derived: boolean
  /** What the PARTNER spends. Never what we owe. */
  amount: number
  /**
   * Whether the run carries a stated cost at all.
   *
   * ⚠️ A self-serve run with no cost is still the partner's own production —
   * it belongs in this bucket at `amount: 0` rather than falling back into the
   * payable list, which is where a naive `filter(r => r.amount > 0)` would put
   * it. Absence of a price is not evidence of a payable.
   */
  costed: boolean
}

/**
 * Split completed runs into the partner's own production and everything else.
 *
 * ⚠️ Runs must have been fetched WITH `metadata`. A guard reading a field the
 * query never asked for is dead code that types perfectly (#1606) — the same
 * trap `isProvenanceRun` carries, and the reason both call sites say so.
 */
export const splitPartnerExpenseRuns = <T extends RunForPayout>(
  runs: T[] | null | undefined
): { commissioned: T[]; ownProduction: T[] } => {
  const commissioned: T[] = []
  const ownProduction: T[] = []
  for (const run of runs || []) {
    ;(isPartnerSelfServeRun(run) ? ownProduction : commissioned).push(run)
  }
  return { commissioned, ownProduction }
}

/**
 * Price the partner's own runs for display, newest first.
 *
 * `designNames` is a plain lookup so each route can pass whatever it already
 * fetched; a miss yields `null` rather than an id masquerading as a name.
 */
export const partnerExpenseRows = (
  runs: (RunForPayout & { completed_at?: any; produced_quantity?: number | null })[],
  designNames?: Map<string, string> | null
): PartnerExpenseRun[] =>
  (runs || [])
    .map((run) => {
      const offer = runPayableOffer(run)
      const designId = run.design_id ? String(run.design_id) : null
      return {
        run_id: String(run.id),
        design_id: designId,
        design_name: (designId && designNames?.get(designId)) || null,
        completed_at: run.completed_at ?? null,
        quantity: offer.quantity,
        quantity_basis: offer.quantity_basis,
        unit_amount: offer.unit_amount,
        unit_is_derived: offer.unit_is_derived,
        amount: offer.amount,
        costed: offer.payable,
      }
    })
    .sort((a, b) => {
      const at = a.completed_at ? new Date(a.completed_at).getTime() : 0
      const bt = b.completed_at ? new Date(b.completed_at).getTime() : 0
      return bt - at
    })

/**
 * What the partner has spent on their own production, across these runs.
 *
 * A bare sum on purpose: this is the partner's money, so the platform states it
 * and does nothing else with it. It is not netted against anything we owe, and
 * it never reduces a payout — the two are different people's money.
 */
export const partnerExpenseTotal = (rows: PartnerExpenseRun[]): number =>
  (rows || []).reduce((sum, r) => sum + (Number(r.amount) || 0), 0)
