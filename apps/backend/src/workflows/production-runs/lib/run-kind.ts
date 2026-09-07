/**
 * Which KIND of row a `production_run` is (#1877).
 *
 * `production_runs` holds at least three different things, and nothing in the
 * schema says which is which:
 *
 *   · **work**   — a real job someone did. `parent_run_id` null, no children.
 *   · **rollup** — an aggregate over children. Its `quantity` and
 *                  `produced_quantity` are the SUM of the children's, so it is
 *                  not a job at all; it is a heading over jobs.
 *   · **stage**  — one step of making a batch. `parent_run_id` set, `role`
 *                  naming the step (Cutting, Block Printing, Tailoring,
 *                  Sampling, manufacturer). Real work, really payable.
 *
 * The distinction is carried implicitly by `parent_run_id`, and every reader is
 * left to know it. The ones that do not are wrong in a way that types
 * perfectly: a rollup passes every status/design/partner gate a real run does,
 * and its quantity is a number like any other. Three separate defects have been
 * the same mistake made by three different readers.
 *
 * ## Which helper to use
 *
 * 🔑 If you already hold the whole SET of a design's runs, do NOT use this —
 * use `leafProductionRuns` in `src/admin/lib/production-run-totals.ts`, which
 * settles the same question from the set alone (#498) and needs no query.
 * These helpers exist for the readers that hold ONE run and cannot see its
 * siblings: they must ask the database whether anything calls it parent.
 */

export type RunKindLike = {
  id?: string | null
  parent_run_id?: string | null
  role?: string | null
  /**
   * How many runs name this one as their parent.
   *
   * ⚠️ NOT a column — it is fetched. `undefined` therefore means UNASKED, not
   * zero, and `isAggregateRun` answers false for it, which is exactly the
   * pre-#1877 behaviour. A guard reading a field its caller never populated is
   * dead code that types perfectly (the same trap `RunForPayout.metadata`
   * carries a warning about), so anything relying on the answer must call
   * `hydrateRunKind` first.
   */
  child_run_count?: number | null
}

/** One step of a batch — real work, and really payable. */
export const isStageRun = (run: RunKindLike | null | undefined): boolean =>
  Boolean(String(run?.parent_run_id ?? "").trim())

/**
 * A heading over other runs, not a job.
 *
 * False when the count was never fetched — see the warning on
 * `child_run_count`.
 */
export const isAggregateRun = (run: RunKindLike | null | undefined): boolean =>
  Number(run?.child_run_count ?? 0) > 0

export type RunKind = "work" | "rollup" | "stage"

/**
 * A rollup is a rollup even when it also has a parent: what makes it uncountable
 * is that something else sums up to it, and that is true at any depth.
 */
export const describeRunKind = (run: RunKindLike | null | undefined): RunKind =>
  isAggregateRun(run) ? "rollup" : isStageRun(run) ? "stage" : "work"

/**
 * How many runs name `runId` as their parent.
 *
 * Cheap by construction — an id-only listing against the indexed column, asked
 * once per run the caller is about to judge.
 */
export const countChildRuns = async (
  scope: any,
  runId: string | null | undefined
): Promise<number> => {
  const id = String(runId ?? "").trim()
  if (!id) return 0

  const service: any = scope.resolve("production_runs")
  const children = await service.listProductionRuns(
    { parent_run_id: id },
    { select: ["id"] }
  )
  return Array.isArray(children) ? children.length : 0
}

/**
 * The run, with `child_run_count` filled in — what `isAggregateRun` needs to
 * answer anything at all.
 *
 * Best-effort: a failed count leaves the field UNASKED rather than asserting
 * zero, because zero is a claim ("this is ordinary work") and a failed query is
 * not evidence for it.
 */
export const hydrateRunKind = async <T extends RunKindLike>(
  scope: any,
  run: T | null | undefined
): Promise<T | null | undefined> => {
  if (!run) return run
  try {
    return { ...run, child_run_count: await countChildRuns(scope, run.id) }
  } catch {
    return run
  }
}
