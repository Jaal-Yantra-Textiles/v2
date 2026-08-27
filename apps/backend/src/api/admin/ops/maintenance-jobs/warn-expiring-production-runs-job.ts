import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import {
  DEFAULT_WARN_BEFORE_DAYS,
  decideExpiringRunWarnings,
  expiryWarningIdempotencyKey,
} from "./lib/inactive-run-cancellation"
import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * Data Plumbing — warn partners whose runs are about to be auto-cancelled.
 *
 * ## Why this exists separately from the sweep
 *
 * #1574 gave us a 28-day inactivity policy that cancels a run and emails the
 * partner. On its own that is a verdict with no notice: the first the partner
 * hears of a deadline is the mail saying it passed. The prod case is a run
 * **81 days** idle — nobody was ever told it was counting.
 *
 * So the warning is its own job, and deliberately not a phase of the cancel
 * sweep. Cancelling is a decision that needs a human behind it; warning is not,
 * which means this one can be scheduled while the sweep stays operator-run.
 *
 * ## What stops it becoming spam
 *
 * 🔑 The send carries an idempotency key of `run + cancel_on`, and the
 * notification module skips a key it has already delivered. Re-run this hourly
 * and each partner still gets exactly ONE warning per deadline — but a run that
 * moves and then goes quiet again earns a new deadline, and so a new warning.
 * The key is not the date it was sent, which would re-mail daily.
 *
 * 🔑 The warning set and the cancellation set are DISJOINT (see
 * `decideExpiringRunWarnings`). A run past the window is the sweep's, not this
 * job's — a warning arriving after the cancellation would read as noise.
 */

const paramsSchema = z.object({
  /** The inactivity window that will cancel the run. Default 28. */
  days: z.coerce.number().int().min(2).max(3650).optional(),
  /** How many days before that window to warn. Default 7. */
  warn_before_days: z.coerce.number().int().min(1).max(3650).optional(),
  /** Cap the number warned in one pass. Default 100. */
  limit: z.coerce.number().int().min(1).max(500).optional(),
  /** Only consider this run — for verifying the decision on one row. */
  production_run_id: z.string().min(1).optional(),
})

const DEFAULT_DAYS = 28
const DEFAULT_LIMIT = 100

export const warnExpiringProductionRunsJob: MaintenanceJob = {
  id: "warn-expiring-production-runs",
  label: "Warn partners about runs approaching the inactivity cancellation",
  description:
    "Emails the partner for every run they are holding (sent_to_partner or in_progress) that is inside the warning lead-time for the inactivity policy — inactive for at least (days - warn_before_days) but not yet past days. The mail names how long it has been idle and the date it will be cancelled, and says that any activity resets the clock. Deliberately DISJOINT from cancel-inactive-production-runs: a run already past the window belongs to that job. Safe to re-run — each partner gets one warning per deadline, enforced by a notification idempotency key of run+cancel date. Dry-run lists every partner it would email, with the stamp the age was measured from.",
  params: [
    {
      name: "days",
      type: "number",
      required: false,
      description:
        "The inactivity window that cancels a run. Default 28 — must match the cancel sweep or the warning names the wrong date.",
    },
    {
      name: "warn_before_days",
      type: "number",
      required: false,
      description:
        "How many days of lead-time to give. Default 7. Clamped to days-1, so it can never warn about work dispatched today.",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: "Maximum partners to email in one pass. Default 100.",
    },
    {
      name: "production_run_id",
      type: "string",
      required: false,
      description:
        "Consider only this run, e.g. 'prod_run_01KTDS2N5DFWD6NNAPE220PD9T'. Useful to check the decision on a single row before sweeping.",
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params ?? {})
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Invalid params: ${parsed.error.issues.map((i) => i.message).join(", ")}`
      )
    }

    const days = parsed.data.days ?? DEFAULT_DAYS
    const warnBeforeDays =
      parsed.data.warn_before_days ?? DEFAULT_WARN_BEFORE_DAYS
    const limit = parsed.data.limit ?? DEFAULT_LIMIT
    const onlyId = parsed.data.production_run_id

    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any

    const { data: runs } = await query.graph({
      entity: "production_runs",
      fields: [
        "id",
        "status",
        "partner_id",
        "created_at",
        "accepted_at",
        "started_at",
        "finished_at",
        "dispatch_started_at",
      ],
      filters: onlyId
        ? { id: onlyId }
        : { status: ["sent_to_partner", "in_progress"] },
    })

    // Captured ONCE so every row in a pass is judged against the same instant
    // and a dry-run can be reproduced exactly.
    const asOf = new Date()
    const decided = decideExpiringRunWarnings((runs || []) as any[], {
      asOf,
      days,
      warnBeforeDays,
    })

    const selected = decided.slice(0, limit)
    const dropped = decided.length - selected.length

    const changes: MaintenanceChange[] = selected.map((d) => ({
      entity: "production_run",
      id: d.id,
      field: "partner_notification",
      before: "none",
      after: "partner-production-run-expiring",
      note: `inactive ${d.inactive_days}d since ${d.last_activity_field}=${d.last_activity_at}; cancels ${d.cancel_on} (in ${d.days_until_cancel}d)`,
    }))

    if (dry_run) {
      return {
        job_id: "warn-expiring-production-runs",
        dry_run: true,
        applied: false,
        // States what was DROPPED — a silent top-N reads as "that was all of
        // them" when it was not.
        summary: `${decided.length} run(s) within ${warnBeforeDays} day(s) of the ${days}-day cancellation; would email ${selected.length}${dropped ? ` (${dropped} beyond the limit of ${limit})` : ""}.`,
        changes,
      }
    }

    const eventBus = container.resolve(Modules.EVENT_BUS) as any
    const errors: Array<{ id: string; message: string }> = []
    let warned = 0

    for (const decision of selected) {
      try {
        await eventBus.emit([
          {
            name: "production_run.expiring",
            data: {
              id: decision.id,
              production_run_id: decision.id,
              action: "expiring",
              inactive_days: decision.inactive_days,
              inactivity_window_days: days,
              days_until_cancel: decision.days_until_cancel,
              cancel_on: decision.cancel_on,
              last_activity_at: decision.last_activity_at,
              idempotency_key: expiryWarningIdempotencyKey(
                decision.id,
                decision.cancel_on
              ),
            },
          },
        ])
        warned++
      } catch (e: any) {
        // One bad row must not abort the pass — the rest are just as close to
        // their deadline, and a partial run that names the failures is more
        // useful than none.
        errors.push({ id: decision.id, message: e?.message || String(e) })
      }
    }

    return {
      job_id: "warn-expiring-production-runs",
      dry_run: false,
      // 🔑 `applied` means the events were EMITTED, not that mail was
      // delivered. The send is a subscriber and a partner with no active admin
      // is skipped quietly there; this job cannot see that far.
      applied: warned > 0,
      summary: `Emitted ${warned} of ${selected.length} expiry warning(s) for runs inactive ${days - warnBeforeDays}–${days} days${dropped ? ` (${dropped} beyond the limit of ${limit})` : ""}${errors.length ? `; ${errors.length} failed` : ""}.`,
      changes,
      ...(errors.length ? { errors } : {}),
    }
  },
}
