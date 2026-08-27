/**
 * #1574 — which production runs have been abandoned long enough to cancel.
 *
 * ## Why a policy exists at all
 *
 * A dispatched run parks the lifecycle workflow on an await step, and those
 * steps carry a timeout. That timeout is 23 days not by choice but by CEILING:
 * `setTimeout` cannot exceed 2_147_483_647 ms — **24.85 days** — so a lifecycle
 * transaction can never outlive ~25 days no matter what we configure.
 *
 * Before this, the timeout enforced nothing. It just left the run `in_progress`
 * with a dead transaction: live by every policy guard, so the screen kept
 * offering Finish, while the signal threw and compensated the work away. A
 * deadline that makes work quietly impossible is not a deadline.
 *
 * The agreed policy is 28 days of INACTIVITY → cancel the run and tell both the
 * admin and the partner, so the work can be re-created and re-assigned (#1228)
 * rather than sitting in a state nobody can move.
 *
 * 🔑 28 > 24.85 on purpose. The transaction is already gone by the time the
 * sweep fires, which is exactly why the missing-transaction path has to be
 * recoverable — a partner finishing on day 26 must still succeed.
 */

/** Statuses a partner is actually sitting on. */
const PARTNER_HELD_STATUSES = new Set(["sent_to_partner", "in_progress"])

export type RunForInactivity = {
  id: string
  status?: string | null
  created_at?: string | Date | null
  accepted_at?: string | Date | null
  started_at?: string | Date | null
  finished_at?: string | Date | null
  dispatch_started_at?: string | Date | null
}

export type InactiveRunDecision = {
  id: string
  status: string
  /** The stamp the age was measured from, named so a dry-run can be argued with. */
  last_activity_at: string
  last_activity_field: string
  inactive_days: number
}

const toTime = (v: unknown): number | null => {
  if (!v) return null
  const t = new Date(v as any).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * The most recent thing that happened to this run, and which field said so.
 *
 * 🔴 NOT `created_at`, and not `updated_at`.
 *
 * `created_at` is wrong because a run can be re-dispatched: prod carries one
 * created 2026-05-26 whose `dispatch_started_at` is 2026-08-21. It is 93 days
 * old and six days active, and a sweep keyed on creation would cancel live work
 * out from under a partner.
 *
 * `updated_at` is wrong in the other direction — every background mirror,
 * backfill and status projection bumps it, so a run nobody has touched for
 * three months can look like it moved this morning. It would make the sweep
 * silently do nothing, which is the harder failure to notice.
 *
 * So: the run's OWN lifecycle stamps, falling back to creation when none has
 * been set — a run dispatched to nobody and never touched is inactive from the
 * moment it existed.
 */
export const lastActivityOf = (
  run: RunForInactivity
): { at: number; field: string } | null => {
  const candidates: [string, number | null][] = [
    ["finished_at", toTime(run.finished_at)],
    ["started_at", toTime(run.started_at)],
    ["accepted_at", toTime(run.accepted_at)],
    ["dispatch_started_at", toTime(run.dispatch_started_at)],
    ["created_at", toTime(run.created_at)],
  ]

  let best: { at: number; field: string } | null = null
  for (const [field, at] of candidates) {
    if (at === null) continue
    if (!best || at > best.at) best = { at, field }
  }
  return best
}

/**
 * The runs an inactivity sweep should cancel, newest-inactive last.
 *
 * `asOf` is injected rather than read from the clock so the decision is
 * testable and a dry-run can be reproduced exactly.
 */
export const decideInactiveRunCancellations = (
  runs: RunForInactivity[],
  opts: { asOf: Date; days: number }
): InactiveRunDecision[] => {
  const cutoff = opts.asOf.getTime() - opts.days * 24 * 60 * 60 * 1000
  const out: InactiveRunDecision[] = []

  for (const run of runs || []) {
    const status = String(run?.status ?? "")
    // Terminal runs are done, and admin-side states (approved,
    // awaiting_reassignment) are not partner inactivity — cancelling those
    // would be the sweep making a scheduling decision that is not its to make.
    if (!PARTNER_HELD_STATUSES.has(status)) continue

    const last = lastActivityOf(run)
    if (!last) continue
    if (last.at > cutoff) continue

    out.push({
      id: String(run.id),
      status,
      last_activity_at: new Date(last.at).toISOString(),
      last_activity_field: last.field,
      inactive_days: Math.floor(
        (opts.asOf.getTime() - last.at) / (24 * 60 * 60 * 1000)
      ),
    })
  }

  return out.sort((a, b) => b.inactive_days - a.inactive_days)
}

/** The reason stamped on the run and sent to the partner. */
export const inactivityCancelReason = (days: number): string =>
  `Cancelled automatically after ${days} days without activity. The work was not started or finished in time — it can be re-created and re-assigned if it is still needed.`

// ---------------------------------------------------------------------------
// The warning that has to come BEFORE the cancellation (#1574)
// ---------------------------------------------------------------------------

export type ExpiringRunDecision = InactiveRunDecision & {
  /** Whole days left before this run reaches the cancellation window. */
  days_until_cancel: number
  /** The date (YYYY-MM-DD) it becomes cancellable. */
  cancel_on: string
}

/** Default: warn a week out from the 28-day window. */
export const DEFAULT_WARN_BEFORE_DAYS = 7

/**
 * The runs that are ABOUT to be cancelled — inactive long enough to be inside
 * the warning lead-time, but not yet past the window.
 *
 * 🔑 The two sets are DISJOINT by construction: a run at or past `days` belongs
 * to `decideInactiveRunCancellations` and is excluded here. That is what stops
 * a partner being warned about a run that the very same sweep then cancels —
 * the warning would arrive after the verdict and read as noise.
 *
 * ⚠️ `warnBeforeDays >= days` would make the window start at or before day 0
 * and warn about work dispatched this morning. It is clamped, not rejected,
 * because a nonsense lead-time must not silently widen the audience.
 */
export const decideExpiringRunWarnings = (
  runs: RunForInactivity[],
  opts: { asOf: Date; days: number; warnBeforeDays: number }
): ExpiringRunDecision[] => {
  const dayMs = 24 * 60 * 60 * 1000
  const lead = Math.max(1, Math.min(opts.warnBeforeDays, opts.days - 1))
  const now = opts.asOf.getTime()
  // Inactive enough to be inside the lead-time…
  const warnFrom = now - (opts.days - lead) * dayMs
  // …but not yet inactive enough to be cancelled.
  const cancelFrom = now - opts.days * dayMs

  const out: ExpiringRunDecision[] = []

  for (const run of runs || []) {
    const status = String(run?.status ?? "")
    if (!PARTNER_HELD_STATUSES.has(status)) continue

    const last = lastActivityOf(run)
    if (!last) continue
    if (last.at > warnFrom) continue // too recent to warn about
    if (last.at <= cancelFrom) continue // already cancellable — not a warning

    const cancelAt = last.at + opts.days * dayMs
    out.push({
      id: String(run.id),
      status,
      last_activity_at: new Date(last.at).toISOString(),
      last_activity_field: last.field,
      inactive_days: Math.floor((now - last.at) / dayMs),
      // Ceil, so "1 day" never means "in four hours". A warning that expires
      // sooner than it claims is worse than one that is a few hours generous.
      days_until_cancel: Math.max(1, Math.ceil((cancelAt - now) / dayMs)),
      cancel_on: new Date(cancelAt).toISOString().slice(0, 10),
    })
  }

  return out.sort((a, b) => a.days_until_cancel - b.days_until_cancel)
}

/**
 * The idempotency key for one run's expiry warning.
 *
 * Keyed on the CANCEL DATE, not the day it was sent: re-running the sweep
 * hourly must not re-mail the partner, but a run that is touched and then goes
 * quiet again has a new cancel date and deserves a fresh warning.
 */
export const expiryWarningIdempotencyKey = (
  runId: string,
  cancelOn: string
): string => `partner-run-expiring:${runId}:${cancelOn}`
