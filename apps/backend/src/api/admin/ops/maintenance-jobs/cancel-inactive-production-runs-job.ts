import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { cancelProductionRunCascade } from "../../../../workflows/production-runs/lib/cancel-production-run-cascade"
import {
  decideInactiveRunCancellations,
  inactivityCancelReason,
} from "./lib/inactive-run-cancellation"
import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * Data Plumbing — cancel production runs a partner has abandoned, and tell
 * everyone it happened.
 *
 * ## Why this exists
 *
 * A dispatched run parks its lifecycle workflow on an await step, and that step
 * carries a timeout of 23 days — not by choice but by CEILING, because
 * `setTimeout` cannot exceed 24.85 days. Before #1574 that timeout enforced
 * nothing at all: it left the run `in_progress` with a dead transaction, live
 * by every policy guard, so the partner's screen kept offering Finish while
 * every click threw and compensated the work away.
 *
 * The agreed policy is **28 days of inactivity → cancel**, with the admin and
 * the partner both told, so the work can be re-created and re-assigned (#1228)
 * instead of sitting where nobody can move it.
 *
 * ## Two things this job deliberately does not do
 *
 * 🔑 It does not touch `approved` or `awaiting_reassignment` runs. Those are
 * admin-side states — no partner has the work, or it has been taken back — so
 * cancelling them would be the sweep making a scheduling decision that is not
 * its to make. Prod carries 6 and 3 of them.
 *
 * 🔑 It measures from LAST ACTIVITY, never from `created_at`. Prod carries a
 * run created 2026-05-26 and re-dispatched 2026-08-21: 93 days old and six days
 * active. See `lastActivityOf` for why `updated_at` is wrong in the other
 * direction.
 */

const paramsSchema = z.object({
  /** Days of inactivity before a run is cancelled. Default 28. */
  days: z.coerce.number().int().min(1).max(3650).optional(),
  /** Cap the number cancelled in one pass. Default 50. */
  limit: z.coerce.number().int().min(1).max(500).optional(),
  /** Only consider this run — for verifying the decision on one row. */
  production_run_id: z.string().min(1).optional(),
})

const DEFAULT_DAYS = 28
const DEFAULT_LIMIT = 50

export const cancelInactiveProductionRunsJob: MaintenanceJob = {
  id: "cancel-inactive-production-runs",
  label: "Cancel production runs abandoned past the inactivity window",
  description:
    "Cancels runs a partner is holding (sent_to_partner or in_progress) that have had no activity for N days (default 28), and emits production_run.cancelled so the partner is emailed and the admin feed records it. Measures from the run's own lifecycle stamps — a re-dispatched run is active work however old it is — never from created_at or updated_at. Leaves terminal runs and admin-side states (approved, awaiting_reassignment) alone. Cancelled work is re-created through run re-assignment. Dry-run lists every run it would cancel, with the stamp the age was measured from.",
  params: [
    {
      name: "days",
      type: "number",
      required: false,
      description:
        "Inactivity window in days. Default 28 — deliberately longer than the 24.85-day setTimeout ceiling on a lifecycle transaction.",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: "Maximum runs to cancel in one pass. Default 50.",
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

    // `asOf` is captured ONCE and passed in, so every row in a pass is judged
    // against the same instant and a dry-run can be reproduced exactly.
    const asOf = new Date()
    const decided = decideInactiveRunCancellations((runs || []) as any[], {
      asOf,
      days,
    })

    const selected = decided.slice(0, limit)
    const dropped = decided.length - selected.length

    const changes: MaintenanceChange[] = selected.map((d) => ({
      entity: "production_run",
      id: d.id,
      field: "status",
      before: d.status,
      after: "cancelled",
      note: `inactive ${d.inactive_days}d since ${d.last_activity_field}=${d.last_activity_at}`,
    }))

    if (dry_run) {
      return {
        job_id: "cancel-inactive-production-runs",
        dry_run: true,
        applied: false,
        // 🔑 States what was DROPPED. A silent top-N reads as "that was all of
        // them" when it was not.
        summary: `${decided.length} run(s) inactive for ${days}+ days; would cancel ${selected.length}${dropped ? ` (${dropped} beyond the limit of ${limit})` : ""}.`,
        changes,
      }
    }

    const errors: Array<{ id: string; message: string }> = []
    let cancelled = 0

    for (const decision of selected) {
      try {
        // 🔑 The run's OWN age, not the policy window. Prod carries one 81 days
        // idle; telling that partner "cancelled after 28 days" reports the rule
        // instead of what happened, and they cannot reconcile it with the run
        // in front of them.
        const result = await cancelProductionRunCascade(
          container,
          decision.id,
          inactivityCancelReason(decision.inactive_days),
          {
            inactive_days: decision.inactive_days,
            inactivity_window_days: days,
            last_activity_at: decision.last_activity_at,
          }
        )
        if (!result.skipped) cancelled++
      } catch (e: any) {
        // One bad row must not abort the sweep — the remaining runs are just as
        // abandoned, and a partial pass that says which failed is more useful
        // than none at all.
        errors.push({ id: decision.id, message: e?.message || String(e) })
      }
    }

    return {
      job_id: "cancel-inactive-production-runs",
      dry_run: false,
      applied: cancelled > 0,
      summary: `Cancelled ${cancelled} of ${selected.length} run(s) inactive for ${days}+ days${dropped ? ` (${dropped} beyond the limit of ${limit})` : ""}${errors.length ? `; ${errors.length} failed` : ""}.`,
      changes,
      ...(errors.length ? { errors } : {}),
    }
  },
}
