import { getRunNextAction, type RunActionKey } from "./run-phase"

/**
 * The "all designs" rules for a COLLATED design work-order (#826, #2357).
 *
 * One order, N designs, each with its own run and its own next step. The old
 * batch bar offered a single "Advance all ready" that accepted some designs and
 * started others in one click, named none of them, and reported failures as a
 * bare count. These rules say, per action, exactly which designs it covers —
 * using the SAME next-action derivation as each design's card, so the bar and
 * the cards can never disagree about what a design owes.
 */

export type CollatedRun = {
  /** The order line the run belongs to (stable React key). */
  lineId: string
  run: any
  /** What the partner calls it — the design's name, else the line title. */
  name: string
  /** False when the design assignment was cancelled: no actions at all. */
  actionable?: boolean
}

export type BulkAction = {
  action: RunActionKey
  runs: CollatedRun[]
}

const ORDER: RunActionKey[] = ["accept", "start", "finish", "complete"]

/** The next step a run owes, via the shared derivation (null when none). */
export const nextActionFor = (r: CollatedRun): RunActionKey | null =>
  getRunNextAction(r.run, { actionable: r.actionable !== false })?.key ?? null

/** Each action some design owes, with the designs that owe it, in lifecycle order. */
export const bulkActions = (runs: CollatedRun[]): BulkAction[] =>
  ORDER.map((action) => ({
    action,
    runs: runs.filter((r) => nextActionFor(r) === action),
  })).filter((b) => b.runs.length > 0)

export const BULK_LABEL: Record<RunActionKey, string> = {
  accept: "Accept all",
  start: "Start all",
  finish: "Finish all",
  complete: "Complete all",
}

export const ACTION_LABEL: Record<RunActionKey, string> = {
  accept: "Accept",
  start: "Start",
  finish: "Finish",
  complete: "Complete",
}

export type BulkFailure = { runId: string; message: string }

/**
 * What a batch did, in words a partner can act on: how many went through and,
 * by NAME, which didn't and why. Null when everything went through.
 */
export const describeBulkFailures = (
  runs: CollatedRun[],
  succeeded: string[],
  failed: BulkFailure[]
): string | null => {
  if (!failed.length) return null
  const nameOf = (id: string) =>
    runs.find((r) => String(r.run?.id) === id)?.name ?? id
  const total = succeeded.length + failed.length
  const head = succeeded.length
    ? `${succeeded.length} of ${total} went through.`
    : "None went through."
  return `${head} ${failed.map((f) => `${nameOf(f.runId)}: ${f.message}`).join("; ")}`
}

/**
 * The Draft payment request that already names one of these runs, if any. The
 * server drafts one on completion (auto-draft); a second request for the same
 * run would be two answers to one question.
 */
export const draftClaimingRuns = (
  submissions: any[],
  runIds: string[]
): any | null =>
  submissions.find(
    (s) =>
      s?.status === "Draft" &&
      (s?.items ?? []).some((item: any) =>
        (Array.isArray(item?.production_run_ids) ? item.production_run_ids : []).some(
          (id: string) => runIds.includes(id)
        )
      )
  ) ?? null

/** `?run_ids=a,b` → the ids to pre-tick, kept only where the run is submittable. */
export const preselectRunIds = (param: string | null, submittable: string[]): string[] =>
  (param ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((id) => id && submittable.includes(id))
