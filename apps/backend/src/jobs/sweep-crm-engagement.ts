import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { crmEngagementSweepJob } from "../api/admin/ops/maintenance-jobs/crm-engagement-sweep-job"

/**
 * The CRM's clock (#1355).
 *
 * `recordCrmActivity` recomputes a contact's engagement state whenever an
 * activity arrives, so every transition DRIVEN BY SOMETHING HAPPENING already
 * fires on its own. Two transitions are driven by time passing and nothing
 * else — a follow-up coming due, and a contact going quiet long enough to count
 * as stalled — and until this job runs, those are only ever discovered when
 * somebody happens to open the record.
 *
 * That mattered more than it sounds. `crm-engagement-sweep` is the only emitter
 * of `crm.follow_up_due` / `crm.contact_stalled` / `crm.contact_replied` /
 * `crm.contact_opted_out`, and `visual-flow-event-trigger` routes those to any
 * flow matching `crm.*`. With the job unscheduled, no CRM event could fire at
 * all: every time-driven flow anyone builds is inert, silently, and looks like
 * a flow that simply never matched. The 230 imported leads sat with
 * `/admin/crm/activities` returning `count: 0`.
 *
 * The job body is the maintenance job itself rather than a copy of it, so the
 * scheduled path and the operator's on-demand
 * `run_maintenance_job("crm-engagement-sweep")` cannot drift apart. Emission is
 * on TRANSITION only — see the job — so running daily does not re-notify a
 * contact who has been sitting at `follow_up_due` for a week.
 */
export default async function sweepCrmEngagement(container: MedusaContainer) {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)

  try {
    const result = await crmEngagementSweepJob.run(container, {
      dry_run: false,
      params: {},
    })

    logger.info(`[crm-engagement-sweep] ${result.summary}`)

    // Per-contact failures are collected rather than thrown, so surface them —
    // otherwise a contact that fails every single night does so invisibly.
    if (result.errors?.length) {
      logger.warn(
        `[crm-engagement-sweep] ${result.errors.length} contact(s) could not be swept: ` +
          result.errors
            .slice(0, 5)
            .map((e) => `${e.id}: ${e.message}`)
            .join("; ") +
          (result.errors.length > 5 ? " …" : "")
      )
    }
  } catch (e: any) {
    // A thrown sweep must not take the scheduler down with it, but it must not
    // pass quietly either — an absent signal read as "nothing to do" is exactly
    // how this went unnoticed in the first place.
    logger.error(`[crm-engagement-sweep] Sweep failed: ${e?.message}`)
  }
}

export const config = {
  name: "sweep-crm-engagement",
  // Daily at 02:30 UTC (08:00 IST) — before the working day, so a follow-up
  // falling due today is already surfaced when someone opens the pipeline.
  // Daily is the right grain: the states it discovers are day-scale (a
  // follow-up date, a contact gone quiet for N days), so sweeping hourly would
  // do the same work 24 times to find the same transitions.
  schedule: "30 2 * * *",
}
