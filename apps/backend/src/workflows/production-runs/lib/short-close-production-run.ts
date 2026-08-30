import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { MedusaContainer } from "@medusajs/framework/types"
import { PRODUCTION_RUNS_MODULE } from "../../../modules/production_runs"

/**
 * SHORT CLOSE — "no more of this run will ever be made" (#1596).
 *
 * ## Why a run needs closing at all
 *
 * The billable ceiling is the run's ORDERED quantity, deliberately: output is
 * captured at completion and a run can legitimately produce more afterwards,
 * which is what the audited correction route exists for. The cost of that is a
 * run ordered for 9 and completed at 7 keeping 2 units billable forever —
 * ordered-quantity headroom cannot tell "not made yet" from "never will be".
 *
 * Two things close it, per the founder (2026-08-30):
 *
 *   1. an explicit admin action, and
 *   2. a counter — after 30 days with no further sign of production, having
 *      seen what was actually made.
 *
 * ## What closing does and does not do
 *
 * It moves the ceiling from ordered to produced. It does NOT claw anything
 * back: a run legitimately billed to 7 and then closed at 4 keeps those 7,
 * `billable_remaining` clamps at 0, and the write guard refuses anything more.
 * There is no route here that un-pays a partner, and there should not be.
 *
 * 🔴 It is reversible, and reversal matters more than the close. An upward
 * output correction on a closed run REOPENS it automatically — the close said
 * "nothing more was made", and a correction is the evidence that it was wrong.
 * Anything else would let a 30-day timer permanently cap a partner's claim on
 * the strength of a figure that has since changed.
 */

export const SHORT_CLOSE_AFTER_DAYS = 30

export type ShortCloseCandidate = {
  id: string
  status?: string | null
  quantity?: number | string | null
  produced_quantity?: number | string | null
  short_closed_at?: Date | string | null
  completed_at?: Date | string | null
}

const finite = (value: unknown): number | null => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const asTime = (value: Date | string | null | undefined): number | null => {
  if (!value) return null
  const t = new Date(value).getTime()
  return Number.isFinite(t) ? t : null
}

export type DueReason =
  | "due"
  | "already_closed"
  | "not_completed"
  | "no_output_figure"
  | "nothing_to_close"
  | "no_clock"
  | "too_recent"

/**
 * PURE: should the counter close this run?
 *
 * `lastOutputAt` is the most recent sign of production — the later of the run's
 * completion and its last audited output correction. Measuring from completion
 * alone would close a run 30 days after it finished even if somebody corrected
 * its output yesterday, which is precisely the case the founder described
 * wanting to see first.
 */
export const shortCloseDecision = (input: {
  run: ShortCloseCandidate
  lastOutputAt: Date | string | null | undefined
  asOf: Date
  afterDays?: number
}): DueReason => {
  const { run } = input

  if (run.short_closed_at) {
    return "already_closed"
  }
  if (String(run.status || "") !== "completed") {
    return "not_completed"
  }

  const produced = finite(run.produced_quantity)
  // No figure, or a zero one. Closing at 0 would wipe a partner's whole claim
  // on the strength of a number nobody confirmed — that needs a human, not a
  // timer. Absence is not permission here, and it is not a penalty either.
  if (produced == null || produced <= 0) {
    return "no_output_figure"
  }

  const ordered = finite(run.quantity)
  if (ordered == null || ordered <= 0 || produced >= ordered) {
    // Nothing to close: the ceiling would not move.
    return "nothing_to_close"
  }

  const since = asTime(input.lastOutputAt) ?? asTime(run.completed_at)
  if (since == null) {
    // A completed run with no completion timestamp has no clock to run. Do not
    // treat a missing date as "long ago".
    return "no_clock"
  }

  const days = (input.asOf.getTime() - since) / 86_400_000
  return days >= (input.afterDays ?? SHORT_CLOSE_AFTER_DAYS) ? "due" : "too_recent"
}

/**
 * Close a run. Idempotent: a run already closed is returned untouched rather
 * than re-stamped, so a retrying job cannot rewrite who closed it or when.
 */
export const shortCloseProductionRun = async (
  container: MedusaContainer,
  input: {
    run_id: string
    /** Admin actor id, or "system" when the counter did it. */
    actor_id: string
    actor_type: "admin" | "system"
    reason?: string | null
  }
): Promise<{ closed: boolean; run: any; reason: string }> => {
  const service: any = container.resolve(PRODUCTION_RUNS_MODULE)
  const run = await service.retrieveProductionRun(input.run_id)

  if (run.short_closed_at) {
    return { closed: false, run, reason: "already_closed" }
  }

  const produced = finite(run.produced_quantity)
  if (produced == null || produced <= 0) {
    // The explicit path refuses too. A close with no output figure would set a
    // ceiling of "ordered" anyway (see `runBillableCeiling`), so it would be a
    // decision that changes nothing while looking like it changed something.
    return { closed: false, run, reason: "no_output_figure" }
  }

  const [updated] = await service.updateProductionRuns([
    {
      id: input.run_id,
      short_closed_at: new Date(),
      short_closed_by: input.actor_id,
      short_close_reason: input.reason ?? null,
      short_closed_quantity: produced,
    },
  ])

  // Audit. Best-effort: the close is already persisted and must not be rolled
  // back because a timeline write failed.
  try {
    await service.createProductionRunActivities({
      production_run_id: input.run_id,
      activity_type: "note",
      kind: "short_closed",
      actor_type: input.actor_type,
      actor_id: input.actor_id,
      partner_id: run.partner_id ?? null,
      channel: null,
      message_id: null,
      template_name: null,
      recipient: null,
      summary: `Run short-closed at ${produced} of ${run.quantity ?? "—"} ordered — no further output expected.`,
      payload: {
        reason: input.reason ?? null,
        ordered_quantity: run.quantity ?? null,
        produced_quantity: produced,
        source: input.actor_type === "system" ? "counter" : "admin",
      },
    })
  } catch {
    /* audit is best-effort */
  }

  return { closed: true, run: updated ?? run, reason: "closed" }
}

/**
 * Reopen a run — the close was premature, or more work is coming.
 *
 * Called explicitly by an admin, and automatically when an output correction
 * raises `produced_quantity` on a closed run.
 */
export const reopenProductionRun = async (
  container: MedusaContainer,
  input: {
    run_id: string
    actor_id: string
    actor_type: "admin" | "system"
    reason?: string | null
  }
): Promise<{ reopened: boolean; run: any }> => {
  const service: any = container.resolve(PRODUCTION_RUNS_MODULE)
  const run = await service.retrieveProductionRun(input.run_id)

  if (!run.short_closed_at) {
    return { reopened: false, run }
  }

  const [updated] = await service.updateProductionRuns([
    {
      id: input.run_id,
      short_closed_at: null,
      short_closed_by: null,
      short_close_reason: null,
      // `short_closed_quantity` is left in place deliberately: it records what
      // was believed at the time of a decision that really happened.
    },
  ])

  try {
    await service.createProductionRunActivities({
      production_run_id: input.run_id,
      activity_type: "note",
      kind: "short_close_reopened",
      actor_type: input.actor_type,
      actor_id: input.actor_id,
      partner_id: run.partner_id ?? null,
      channel: null,
      message_id: null,
      template_name: null,
      recipient: null,
      summary: `Short close reversed — the run is billable to its ordered quantity again.`,
      payload: {
        reason: input.reason ?? null,
        was_closed_at: run.short_closed_at ?? null,
        was_closed_quantity: run.short_closed_quantity ?? null,
      },
    })
  } catch {
    /* audit is best-effort */
  }

  return { reopened: true, run: updated ?? run }
}

/**
 * The most recent sign of production per run: the later of completion and the
 * last audited output correction.
 */
export const lastOutputSignalByRun = async (
  container: MedusaContainer,
  runIds: string[]
): Promise<Map<string, Date>> => {
  const byRun = new Map<string, Date>()
  const ids = [...new Set((runIds || []).filter(Boolean).map(String))]
  if (!ids.length) {
    return byRun
  }

  const service: any = container.resolve(PRODUCTION_RUNS_MODULE)
  try {
    const activities = await service.listProductionRunActivities({
      production_run_id: ids,
      kind: "output_corrected",
    })
    for (const activity of (activities || []) as any[]) {
      const runId = String(activity.production_run_id || "")
      const at = activity.created_at ? new Date(activity.created_at) : null
      if (!runId || !at || !Number.isFinite(at.getTime())) {
        continue
      }
      const existing = byRun.get(runId)
      if (!existing || at > existing) {
        byRun.set(runId, at)
      }
    }
  } catch {
    // No activity history available ⇒ fall back to completion, which the
    // decision does on its own. Never treat this as "no corrections ever".
  }

  return byRun
}

/**
 * Every completed run the counter should close, as of `asOf`.
 *
 * Reports what it SKIPPED as well as what is due — a sweep that silently
 * narrows its own candidate set reads as "nothing to do" when it means "I
 * could not tell".
 */
export const findRunsDueForShortClose = async (
  container: MedusaContainer,
  options: { asOf?: Date; afterDays?: number; limit?: number } = {}
): Promise<{
  due: ShortCloseCandidate[]
  scanned: number
  skipped: Record<string, number>
}> => {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const asOf = options.asOf ?? new Date()

  const { data } = await query.graph({
    entity: "production_runs",
    fields: [
      "id",
      "status",
      "quantity",
      "produced_quantity",
      "short_closed_at",
      "completed_at",
      "partner_id",
    ],
    filters: { status: "completed" },
  })

  const runs = (Array.isArray(data) ? data : []) as ShortCloseCandidate[]
  const signals = await lastOutputSignalByRun(
    container,
    runs.map((r) => String(r.id))
  )

  const due: ShortCloseCandidate[] = []
  const skipped: Record<string, number> = {}

  for (const run of runs) {
    const verdict = shortCloseDecision({
      run,
      lastOutputAt: signals.get(String(run.id)) ?? run.completed_at,
      asOf,
      afterDays: options.afterDays,
    })
    if (verdict === "due") {
      due.push(run)
      continue
    }
    skipped[verdict] = (skipped[verdict] ?? 0) + 1
  }

  return {
    due: options.limit ? due.slice(0, options.limit) : due,
    scanned: runs.length,
    skipped,
  }
}
