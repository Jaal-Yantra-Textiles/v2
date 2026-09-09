/**
 * PURE: roll a parent run's totals up from its children (#1877).
 *
 * A parent `production_run` is a heading over jobs, not a job — see
 * `run-kind.ts`. Its `quantity` and `produced_quantity` are meant to be the
 * SUM of its children's, and three separate places completed a parent:
 *
 *   · `complete-production-run.ts` — the inline cascade, which DID reconcile
 *     totals;
 *   · `run-production-run-lifecycle.ts` — the signal-driven cascade, which set
 *     `status` and `completed_at` and **nothing else**;
 *   · `scripts/repair-stuck-parent-production-runs.ts` — the repair.
 *
 * Two of the three summed; the middle one did not. So whether a completed
 * parent carried the output the partner actually reported came down to which
 * path happened to fire — and the lifecycle path leaves the parent reading
 * `produced_quantity: null` with children that each state a real number. Seven
 * such parents exist in production today. Every downstream reader (cost
 * summary, payout, provenance, order fulfilment) then falls back to the
 * ORDERED quantity and quietly assumes it was all made, which is the same
 * failure `checkCompletionOutput` exists to prevent one level down.
 *
 * This is the one place that decides. All three callers use it.
 */

export type RollupChild = {
  id?: string | null
  status?: string | null
  quantity?: number | string | null
  produced_quantity?: number | string | null
  completed_at?: Date | string | null
}

export type ParentRollup = {
  /** Every child is `completed` — the precondition for completing the parent. */
  all_completed: boolean
  /** Σ children's `quantity`. */
  quantity: number
  /**
   * Σ children's `produced_quantity`, counting ONLY the children that state
   * one. This is the honest figure: it never invents output for a child that
   * never reported any.
   */
  produced_stated: number
  /**
   * Σ children's `produced_quantity`, falling back to the child's ORDERED
   * `quantity` where it is null.
   *
   * ⚠️ This fabricates output for a child that never reported any, so it is
   * only safe where the completion gate has already run. `checkCompletionOutput`
   * refuses a completion with `quantity > 0` and no produced figure, so for any
   * child completed after that gate landed the fallback contributes 0 and is
   * identical to `produced_stated`. It differs only on rows that predate the
   * gate — which is exactly where a BACKFILL must not use it.
   */
  produced_with_fallback: number
  /** Children that are completed but state no `produced_quantity`. */
  children_missing_produced: number
  /** Latest child `completed_at`, or null if no child carries one. */
  completed_at: Date | null
}

const finite = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function computeParentRollup(
  children: readonly RollupChild[] | null | undefined
): ParentRollup {
  const kids = children ?? []

  let quantity = 0
  let producedStated = 0
  let producedWithFallback = 0
  let missing = 0
  let latestMs = 0

  for (const c of kids) {
    const qty = finite(c?.quantity)
    const produced = finite(c?.produced_quantity)

    if (qty !== null) quantity += qty

    if (produced !== null) {
      producedStated += produced
      producedWithFallback += produced
    } else {
      missing++
      if (qty !== null) producedWithFallback += qty
    }

    const at = c?.completed_at
    if (at) {
      const ms = new Date(at).getTime()
      if (Number.isFinite(ms) && ms > latestMs) latestMs = ms
    }
  }

  return {
    // An empty child set is NOT "all completed" — a parent with no children is
    // not a rollup and must not be completed by this path.
    all_completed:
      kids.length > 0 &&
      kids.every((c) => String(c?.status || "") === "completed"),
    quantity,
    produced_stated: producedStated,
    produced_with_fallback: producedWithFallback,
    children_missing_produced: missing,
    completed_at: latestMs ? new Date(latestMs) : null,
  }
}

/**
 * The `quantity` / `produced_quantity` patch to apply to a parent, given a
 * rollup. Zero totals are omitted rather than written, so a rollup that
 * genuinely knows nothing leaves the parent's existing values alone instead of
 * overwriting them with 0 — `0` and `null` mean different things here and a
 * reader cannot tell "made none" from "never said".
 */
export function parentTotalsPatch(
  rollup: ParentRollup,
  opts: { allowFallback?: boolean } = {}
): { quantity?: number; produced_quantity?: number } {
  const produced = opts.allowFallback
    ? rollup.produced_with_fallback
    : rollup.produced_stated

  return {
    ...(rollup.quantity > 0 ? { quantity: rollup.quantity } : {}),
    ...(produced > 0 ? { produced_quantity: produced } : {}),
  }
}
