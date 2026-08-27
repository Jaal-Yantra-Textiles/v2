/**
 * #1574 — is this signalling failure "the lifecycle transaction is gone"?
 *
 * Every lifecycle await step carries a 23-day timeout, so a partner slower than
 * that finds the workflow expired underneath them. The run itself is untouched:
 * `in_progress`, `started_at` set, live by every policy guard — so the screen
 * goes on offering Finish, and each click threw, compensated the whole finish
 * workflow, and rolled `finished_at` back to null. Permanently unfinishable.
 *
 * Recovering from it is safe because there is provably nothing on the other
 * side: the lifecycle workflow's only work after the awaits is
 * `cascadeCompletionStep`, and `complete-production-run` already performs that
 * cascade INLINE for exactly this reason.
 *
 * ⚠️ A PREDICATE, not a wider catch. Swallowing every engine error would hide
 * genuine signalling failures on runs whose transaction IS live — which is the
 * failure the guard exists to surface. Only "it does not exist" is recoverable.
 *
 * The two spellings are both real: the redis engine (prod) says
 * "Transaction <id> could not be found." and the in-memory engine says
 * "Transaction not found".
 */
export const isMissingLifecycleTransaction = (
  message: unknown
): boolean => {
  const m = String(message ?? "")
  if (!m) return false
  return (
    /transaction\s+.*could not be found/i.test(m) ||
    /transaction not found/i.test(m)
  )
}

/**
 * The engine's way of saying "this step already succeeded". Idempotent, and
 * always safe to ignore — a partner double-clicking Finish is not an error.
 */
export const isAlreadySignalled = (message: unknown): boolean =>
  String(message ?? "").includes("status is ok")
