import { cleanIds } from "./run-dependencies"

/**
 * Checks for telling an EXISTING run to wait on other runs (#2306).
 *
 * Approval derives `depends_on_run_ids` from the assignment `order`, and that
 * only works for children of one parent splitting the pieces between them. Two
 * partners working the SAME pieces one after the other — embroider, then
 * stitch — could never be expressed: the design route refuses assignments whose
 * quantities sum past the run's, and nothing could add the edge afterwards.
 * This is the afterwards.
 *
 * Unlike an inventory-order id (where an unreadable id simply stalls the run),
 * a run-to-run edge can be wrong in ways that stall it FOREVER and silently:
 *
 *   - itself              — waits on its own completion
 *   - a cancelled run     — will never reach `completed`
 *   - a cycle             — A waits on B waits on A; neither ever starts
 *   - an id that is not a run — a typo that reads exactly like a real wait
 *
 * Each is refused here, with the reason, before anything is written.
 */

export type RunDependencyReader = (ids: string[]) => Promise<any[]>

export type RunDependencyCheck =
  | { ok: true; ids: string[] }
  | { ok: false; message: string }

/** How far the cycle walk goes. Real chains are a handful of stages deep. */
const MAX_WALK = 500

export const checkRunDependencyAttach = async (
  runId: string,
  raw: unknown,
  readRuns: RunDependencyReader
): Promise<RunDependencyCheck> => {
  if (raw === null) {
    return { ok: true, ids: [] }
  }
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      message:
        "depends_on_run_ids must be an array of production run ids, or null to clear it",
    }
  }

  const ids = Array.from(
    new Set(
      raw
        .map((v: unknown) => (typeof v === "string" ? v.trim() : ""))
        .filter((v: string) => v.length > 0)
    )
  )
  if (!ids.length) {
    return { ok: true, ids: [] }
  }

  if (ids.includes(runId)) {
    return { ok: false, message: "A production run cannot wait on itself." }
  }

  const upstream = await readRuns(ids)
  const byId = new Map(upstream.map((r: any) => [String(r.id), r]))

  const missing = ids.filter((i) => !byId.has(i))
  if (missing.length) {
    return {
      ok: false,
      message: `No production run found for: ${missing.join(", ")}`,
    }
  }

  const cancelled = ids.filter(
    (i) => String(byId.get(i)?.status) === "cancelled"
  )
  if (cancelled.length) {
    return {
      ok: false,
      message: `Cannot wait on a cancelled run — it will never complete: ${cancelled.join(", ")}`,
    }
  }

  /*
   * Cycle: walk upstream from the new edges. If the walk reaches this run, then
   * this run would (transitively) wait on itself. Breadth-first over what the
   * upstream runs ALREADY wait on, reading one layer at a time.
   */
  const seen = new Set<string>(ids)
  let frontier = upstream
  let walked = 0
  while (frontier.length && walked < MAX_WALK) {
    const next = Array.from(
      new Set(frontier.flatMap((r: any) => cleanIds(r?.depends_on_run_ids)))
    ).filter((i) => !seen.has(i))

    if (next.includes(runId)) {
      return {
        ok: false,
        message:
          "That would make a loop: one of those runs already waits (directly or through others) on this run, so neither could ever start.",
      }
    }
    if (!next.length) break

    next.forEach((i) => seen.add(i))
    walked += next.length
    frontier = await readRuns(next)
  }

  return { ok: true, ids }
}
