/**
 * #1898 — the two rules that decide whether a run awaiting review can be SEEN.
 *
 * Extracted from JSX so they can be exercised. Both were previously inline
 * expressions, and both were wrong in a way no test could reach.
 */

/**
 * Whether the production-run list should hide child runs.
 *
 * The list hardcoded `true`. A child run carries its own `approval_decision`,
 * and on production 28 of 70 completed runs were children — so the review queue
 * could never be emptied from that page: `applyRunApprovals` writes the
 * decision onto the runs in the SELECTION, and a run that is never listed is
 * never selected.
 *
 * Parents-only stays the default, because a parent is the aggregator an
 * operator normally wants. But asking for the review queue must show every run
 * awaiting review, children included, or the filter is lying about its name.
 */
export const shouldExcludeChildRuns = (input: {
  /** The explicit Scope filter, when the operator has set one. */
  scopeFilter?: string
  /** The Review filter. `"none"` is the review queue. */
  reviewFilter?: string
}): boolean => {
  if (input.scopeFilter === "all") return false
  if (input.scopeFilter === "parents") return true
  return input.reviewFilter !== "none"
}

/**
 * The runs on a design that nobody has decided about yet.
 *
 * `approval_decision` is a separate axis from `status` (#1805): a rejected run
 * stays `completed`, so "completed" alone does not mean "needs a decision", and
 * `null` is the only value meaning nobody has looked.
 *
 * Uses `== null` deliberately — it must catch both `null` and `undefined`, and
 * must NOT treat a decided run as undecided.
 */
export const runsAwaitingOutputReview = <T extends { status?: unknown; approval_decision?: unknown }>(
  runs: readonly T[] | null | undefined
): T[] =>
  (runs ?? []).filter(
    (r) => r?.status === "completed" && r?.approval_decision == null
  )
