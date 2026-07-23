/**
 * Pure helpers for summarising a design's production runs without double-counting.
 *
 * Background (#498): a design's production runs come back as a PARENT run plus
 * one CHILD run per partner assignment, all sharing the same `design_id` (the
 * children are created in `approveProductionRunWorkflow` with
 * `parent_run_id = parent.id` and `design_id = parent.design_id`). The parent's
 * `quantity` already equals the sum of its children's quantities, so naively
 * summing every returned run double-counts the parent against its children
 * (e.g. parent 10 + child 4 + child 6 = 20 instead of 10).
 *
 * The fix is to sum only LEAF runs — runs that are not referenced as any other
 * run's `parent_run_id`, at any depth. A simple run with no children is itself
 * a leaf, so non-assigned runs are still counted exactly once.
 */

export type ProductionRunLike = {
  id?: string | null
  parent_run_id?: string | null
  status?: string | null
  quantity?: number | null
}

export const COMPLETED_STATUSES = ["completed"] as const
export const IN_PROGRESS_STATUSES = [
  "in_progress",
  "sent_to_partner",
  "approved",
  // #1093 — a run awaiting reassignment is still outstanding work (not done,
  // not cancelled); count it as in-progress so pending work isn't undercounted.
  "awaiting_reassignment",
] as const

export type ProductionRunTotals = {
  /** Sum of completed leaf-run quantities. */
  completed: number
  /** Sum of in-progress leaf-run quantities. */
  inProgress: number
  /** Number of leaf runs (parents with children are excluded). */
  leafCount: number
  /** Total number of run records returned (parents + children). */
  total: number
}

/**
 * Return only the leaf runs — runs that are NOT the `parent_run_id` of any other
 * run in the set. Leaf detection uses the full set (so status filtering can't
 * accidentally promote a parent to a leaf) and is depth-agnostic.
 */
export function leafProductionRuns<T extends ProductionRunLike>(runs: T[]): T[] {
  const list = Array.isArray(runs) ? runs : []
  const parentIds = new Set<string>()
  for (const r of list) {
    if (r?.parent_run_id) {
      parentIds.add(String(r.parent_run_id))
    }
  }
  return list.filter((r) => !(r?.id != null && parentIds.has(String(r.id))))
}

/**
 * Summarise a design's production runs, counting each unit of work exactly once
 * by summing leaf runs only. See file header for the #498 rationale.
 */
export function summarizeProductionRunTotals(
  runs: ProductionRunLike[]
): ProductionRunTotals {
  const list = Array.isArray(runs) ? runs : []
  const leaves = leafProductionRuns(list)

  const sumByStatus = (statuses: readonly string[]) =>
    leaves
      .filter((r) => statuses.includes(r?.status ?? ""))
      .reduce((acc, r) => acc + (Number(r?.quantity) || 0), 0)

  return {
    completed: sumByStatus(COMPLETED_STATUSES),
    inProgress: sumByStatus(IN_PROGRESS_STATUSES),
    leafCount: leaves.length,
    total: list.length,
  }
}
