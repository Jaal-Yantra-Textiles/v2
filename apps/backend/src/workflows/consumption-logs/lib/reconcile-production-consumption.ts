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

export type ConsumptionBasis = "total" | "per_piece"

export type ReconcileLog = {
  id: string
  design_id?: string | null
  inventory_item_id?: string | null
  production_run_id?: string | null
  quantity?: number | string | null
  /**
   * What `quantity` MEASURES. `per_piece` makes it a rate, not a total — the
   * whole reason this module cannot just sum the column. Null on logs written
   * before the form asked, and never guessed.
   */
  quantity_basis?: ConsumptionBasis | null
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
  /**
   * Committed material logs whose total could NOT be resolved — a null basis
   * with no assumption supplied, or a per-piece rate with no piece count to
   * multiply by. Their quantity is absent from `consumed`.
   */
  unresolved_logs: number
  /** The raw, UNRESOLVED `quantity` sum of those logs. Not a total of anything. */
  unresolved_quantity: number
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
 * That is now recorded: `consumption_log.quantity_basis` says which reading was
 * meant, and this module resolves a `per_piece` log the way
 * `apply-committed-consumption-to-inventory` does — rate × pieces — before
 * summing. Summing the raw column instead compared an expected TOTAL against a
 * RATE and reported a shortfall that did not exist, on every per-piece design
 * (#1559). On a run of one the two readings coincide, which is how it survived.
 *
 * A NULL basis is still never guessed. Those logs are counted as `unresolved`
 * and excluded from `consumed`, and any verdict that depends on knowing the
 * total — `produced_without_consumption`, `implausible_rate`, `under_expected` —
 * is withheld for that design in favour of `unknown_basis`. An operator who
 * knows how a batch of legacy logs was entered passes `assumeBasisWhenUnknown`,
 * exactly as the apply job's `assume_basis` works.
 */
export type ReconcileFlag =
  | "produced_without_consumption"
  | "consumption_without_production"
  | "implausible_rate"
  | "unattributed_consumption"
  | "under_expected"
  /** At least one log could not be read as a total — see `unresolved_logs`. */
  | "unknown_basis"

/**
 * A run minted from retail fulfillment: born terminal, no shop-floor work, no
 * material consumed. Identified by the create-side marker alone — the creator
 * also mints DESIGN-BACKED provenance runs, so testing for a null design_id
 * would let exactly the design-attached ones through, which are the only kind
 * that can reach a design's reconciliation at all.
 */
/**
 * ⚠️ Typed on the ONE field it reads rather than on `ReconcileRun`, so the
 * payout side can ask the same question of a run shaped for payout (#1606).
 * One owner for this test — a second place re-checking the metadata key is how
 * the materials side and the money side come to disagree about what a
 * provenance run is.
 */
export function isProvenanceRun(
  run:
    | { metadata?: Record<string, any> | null; [key: string]: any }
    | null
    | undefined
): boolean {
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
  /**
   * How to read logs written before the form recorded a basis. OPT-IN, and
   * deliberately not defaulted: guessing `total` is what produced the wrong
   * report in the first place. Omitted, those logs stay unresolved.
   */
  assumeBasisWhenUnknown?: ConsumptionBasis
}): DesignReconciliation[] {
  const implausibleBelow = input.implausibleRateBelow ?? 0.5
  const rates = input.ratePerUnit ?? {}

  const leaves = leafRuns(
    (input.runs || []).filter((r) => r?.design_id)
  ).filter((r) => r.status === "completed")

  const produced: Record<string, number> = {}
  const provenance: Record<string, number> = {}
  // Pieces per RUN, so a log attributed to one run is multiplied by that run's
  // own yield rather than by everything the design ever made.
  const piecesByRun: Record<string, number> = {}
  for (const r of leaves) {
    const d = String(r.design_id)
    // produced_quantity is the reported yield; fall back to the ordered
    // quantity only when the yield was never recorded.
    const q = num(r.produced_quantity ?? r.quantity)
    if (isProvenanceRun(r)) {
      provenance[d] = round((provenance[d] ?? 0) + q)
    } else {
      piecesByRun[String(r.id)] = q
      produced[d] = round((produced[d] ?? 0) + q)
    }
  }

  const consumed: Record<string, number> = {}
  const unattributed: Record<string, number> = {}
  const unresolvedCount: Record<string, number> = {}
  const unresolvedQty: Record<string, number> = {}
  for (const l of input.logs || []) {
    // Labour (`Hour`) and energy (`kWh`) logs carry a raw_material_id instead of
    // an inventory item; they are not material and must not enter a metres-per-
    // piece rate.
    if (!l?.is_committed || !l.inventory_item_id || !l.design_id) {
      continue
    }
    const d = String(l.design_id)
    if (!l.production_run_id) {
      unattributed[d] = (unattributed[d] ?? 0) + 1
    }

    const raw = num(l.quantity)
    const unresolved = () => {
      unresolvedCount[d] = (unresolvedCount[d] ?? 0) + 1
      unresolvedQty[d] = round((unresolvedQty[d] ?? 0) + raw)
    }

    const basis = l.quantity_basis ?? input.assumeBasisWhenUnknown
    if (!basis) {
      unresolved()
      continue
    }
    if (basis === "total") {
      consumed[d] = round((consumed[d] ?? 0) + raw)
      continue
    }
    // per_piece: the column is a RATE. Pieces come from the log's own run when
    // it has one, else from everything the design completed — the same order
    // the apply job resolves them in, so the two jobs cannot disagree about
    // what a log means.
    const pieces =
      (l.production_run_id ? piecesByRun[String(l.production_run_id)] : undefined) ??
      produced[d]
    if (!pieces || pieces <= 0) {
      unresolved()
      continue
    }
    consumed[d] = round((consumed[d] ?? 0) + raw * pieces)
  }

  const designIds = new Set([
    ...Object.keys(produced),
    ...Object.keys(provenance),
    ...Object.keys(consumed),
    ...Object.keys(unresolvedCount),
  ])

  const out: DesignReconciliation[] = []
  for (const design_id of designIds) {
    const p = produced[design_id] ?? 0
    const c = consumed[design_id] ?? 0
    const unresolved = unresolvedCount[design_id] ?? 0
    const rate = rates[design_id]
    const expected = rate != null && p > 0 ? round(rate * p) : null
    const implied = p > 0 && c > 0 ? round(c / p) : null
    const flags: ReconcileFlag[] = []

    // With an unreadable log in the mix, `consumed` is a floor and not a total.
    // Every verdict below compares against it, so they are withheld rather than
    // stated against a figure known to be short — a false `under_expected` is
    // an instruction to "correct" a log that is already right.
    if (unresolved > 0) {
      flags.push("unknown_basis")
    } else {
      if (p > 0 && c === 0) {
        flags.push("produced_without_consumption")
      }
      if (implied != null && implied < implausibleBelow) {
        flags.push("implausible_rate")
      }
      if (expected != null && c < expected) {
        flags.push("under_expected")
      }
    }
    // Production with no material at all is not in doubt either way: there is
    // no log to have misread.
    if (p === 0 && c > 0) {
      flags.push("consumption_without_production")
    }
    if ((unattributed[design_id] ?? 0) > 0) {
      flags.push("unattributed_consumption")
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
      unresolved_logs: unresolved,
      unresolved_quantity: unresolvedQty[design_id] ?? 0,
      flags,
    })
  }

  // Worst first: most produced with least accounted for.
  return out.sort((a, b) => b.produced - a.produced || b.consumed - a.consumed)
}
