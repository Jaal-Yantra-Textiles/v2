/**
 * Reconcile what a design PRODUCED against what it reported CONSUMING.
 *
 * Committing a consumption log is the only signal we have that material left the
 * shelf, and on prod that signal is mostly missing: of nine designs with real
 * production, five have logged no material at all, and one reports 1.75 m against
 * nine finished pieces. Deducting those figures moves a rounding error while the
 * real outflow stays invisible, so the gap has to be measurable before any of it
 * is settled against stock.
 *
 * This module is deliberately REPORT-ONLY and computes no stock movement. An
 * expected quantity is a model, not a measurement; writing one into
 * `stocked_quantity` would make the ledger mean "what we think is on the shelf"
 * and let every future variance compound invisibly. The variance is surfaced so
 * a human can correct the LOG — which the existing apply job then deducts.
 */

/** Only what reconciliation needs; mirrors the production_run model subset. */
export type ReconcileRun = {
  id: string
  design_id?: string | null
  parent_run_id?: string | null
  status?: string | null
  produced_quantity?: number | null
  quantity?: number | null
  metadata?: Record<string, any> | null
}

export type ReconcileLog = {
  id: string
  design_id?: string | null
  inventory_item_id?: string | null
  production_run_id?: string | null
  quantity?: number | string | null
  is_committed?: boolean
}

export type DesignReconciliation = {
  design_id: string
  /** Completed leaf-run output, provenance excluded — pieces we actually made. */
  produced: number
  /** Completed provenance quantity — shipped from stock, consumed nothing. */
  shipped_from_stock: number
  /** Committed material consumption (labour/energy logs excluded). */
  consumed: number
  /** consumed / produced, or null when nothing was produced. */
  implied_rate: number | null
  /** Expected consumption when a per-unit rate is known, else null. */
  expected: number | null
  /** expected - consumed, when expected is known. */
  variance: number | null
  /** Committed material logs not attributed to any production run. */
  unattributed_logs: number
  flags: ReconcileFlag[]
}

/**
 * `implausible_rate` usually means the operator entered a PER-PIECE figure into
 * a field the system reads as a TOTAL.
 *
 * `quantity` is unambiguously a total everywhere it is used — `unit_cost` is
 * priced per unit-of-measure and the design UI renders `quantity × unit_cost` as
 * the line's total cost, so a per-piece entry silently understates cost as well
 * as stock. But the capture form is labelled only "Quantity", with no piece
 * count and no run attached, so nothing tells the operator which is meant.
 *
 * The gap is procedural: partners are ASKED for consumption PER PIECE, but the
 * partner form is a mirror of the admin one — labelled only "Quantity", sending
 * no production_run_id — and the value lands in a column every consumer reads as
 * a total. So a per-piece answer is stored, costed and deducted as though it
 * were the whole run's material, understating both by the piece count.
 *
 * Prod shows both readings side by side: "Denim Trouser" (admin) logs 2.15 m
 * against 2 pieces — 1.07 m/piece, sensible as a total — while "Lets test this
 * design" (partner) logs 5 m against 5 pieces, which under the per-piece rule is
 * 25 m of real consumption against 5 m recorded.
 *
 * This module therefore does NOT multiply. Resolving it needs the basis recorded
 * explicitly on the log (`total` vs `per_piece`) plus a run attribution to supply
 * the piece count — most partner logs currently carry neither, and no
 * multiplication is safe until they do.
 */
export type ReconcileFlag =
  | "produced_without_consumption"
  | "consumption_without_production"
  | "implausible_rate"
  | "unattributed_consumption"
  | "under_expected"

/**
 * A run minted from retail fulfillment: born terminal, no shop-floor work, no
 * material consumed. Identified by the create-side marker alone — the creator
 * also mints DESIGN-BACKED provenance runs, so testing for a null design_id
 * would let exactly the design-attached ones through, which are the only kind
 * that can reach a design's reconciliation at all.
 */
export function isProvenanceRun(run: ReconcileRun): boolean {
  return run?.metadata?.source === "order.fulfillment_created"
}

/**
 * #498: a design's runs come back as a parent plus one child per partner
 * assignment, the parent's quantity already being the sum of its children.
 * Counting both double-counts, so only leaves are summed.
 */
export function leafRuns(runs: ReconcileRun[]): ReconcileRun[] {
  const parentIds = new Set(
    runs.map((r) => r?.parent_run_id).filter(Boolean).map(String)
  )
  return runs.filter((r) => !parentIds.has(String(r.id)))
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

/** Decimal metres — see the rounding note in ./apply-to-inventory. */
const round = (n: number): number => Number(n.toFixed(6))

/**
 * PURE. Exported for unit tests.
 *
 * `ratePerUnit` is the expected material per finished piece, keyed by design.
 * It is optional: with no rate we still report the IMPLIED rate, which is what
 * makes a 0.19 m/piece design visible without anyone having specified a spec.
 */
export function reconcileDesigns(input: {
  runs: ReconcileRun[]
  logs: ReconcileLog[]
  ratePerUnit?: Record<string, number>
  /** Below this implied rate, flag the design. Default 0.5 (metres/piece). */
  implausibleRateBelow?: number
}): DesignReconciliation[] {
  const implausibleBelow = input.implausibleRateBelow ?? 0.5
  const rates = input.ratePerUnit ?? {}

  const leaves = leafRuns(
    (input.runs || []).filter((r) => r?.design_id)
  ).filter((r) => r.status === "completed")

  const produced: Record<string, number> = {}
  const provenance: Record<string, number> = {}
  for (const r of leaves) {
    const d = String(r.design_id)
    // produced_quantity is the reported yield; fall back to the ordered
    // quantity only when the yield was never recorded.
    const q = num(r.produced_quantity ?? r.quantity)
    if (isProvenanceRun(r)) {
      provenance[d] = round((provenance[d] ?? 0) + q)
    } else {
      produced[d] = round((produced[d] ?? 0) + q)
    }
  }

  const consumed: Record<string, number> = {}
  const unattributed: Record<string, number> = {}
  for (const l of input.logs || []) {
    // Labour (`Hour`) and energy (`kWh`) logs carry a raw_material_id instead of
    // an inventory item; they are not material and must not enter a metres-per-
    // piece rate.
    if (!l?.is_committed || !l.inventory_item_id || !l.design_id) {
      continue
    }
    const d = String(l.design_id)
    consumed[d] = round((consumed[d] ?? 0) + num(l.quantity))
    if (!l.production_run_id) {
      unattributed[d] = (unattributed[d] ?? 0) + 1
    }
  }

  const designIds = new Set([
    ...Object.keys(produced),
    ...Object.keys(provenance),
    ...Object.keys(consumed),
  ])

  const out: DesignReconciliation[] = []
  for (const design_id of designIds) {
    const p = produced[design_id] ?? 0
    const c = consumed[design_id] ?? 0
    const rate = rates[design_id]
    const expected = rate != null && p > 0 ? round(rate * p) : null
    const flags: ReconcileFlag[] = []

    if (p > 0 && c === 0) {
      flags.push("produced_without_consumption")
    }
    if (p === 0 && c > 0) {
      flags.push("consumption_without_production")
    }
    const implied = p > 0 && c > 0 ? round(c / p) : null
    if (implied != null && implied < implausibleBelow) {
      flags.push("implausible_rate")
    }
    if ((unattributed[design_id] ?? 0) > 0) {
      flags.push("unattributed_consumption")
    }
    if (expected != null && c < expected) {
      flags.push("under_expected")
    }

    out.push({
      design_id,
      produced: p,
      shipped_from_stock: provenance[design_id] ?? 0,
      consumed: c,
      implied_rate: implied,
      expected,
      variance: expected != null ? round(expected - c) : null,
      unattributed_logs: unattributed[design_id] ?? 0,
      flags,
    })
  }

  // Worst first: most produced with least accounted for.
  return out.sort((a, b) => b.produced - a.produced || b.consumed - a.consumed)
}
