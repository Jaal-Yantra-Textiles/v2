import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { PRODUCTION_RUNS_MODULE } from "../modules/production_runs"
import type ProductionRunService from "../modules/production_runs/service"

/**
 * Delivers production-run escalations to a human (#1279).
 *
 * Both top rungs of the reminder ladder used to end in silence:
 *
 *   sent_to_partner → reminders → cap → awaiting_reassignment → nothing
 *   accepted        → reminders → cap → "escalated to admin"  → an activity row
 *
 * The second one is the subtle failure. `production_run.reminder_escalated`
 * has existed since #1093 and its only consumer was
 * `production-run-activity-recorder.ts`, which writes a timeline row labelled
 * "Reminder cap reached — escalated to admin". Nobody reads a timeline row.
 * The event named an audience it never reached.
 *
 * This subscriber is that audience. It is the ONLY thing standing between an
 * escalation and nobody hearing it, so it is deliberately dumb: read the run,
 * compose a sentence a human can act on, post it to the admin feed. No
 * decisions, no writes to the run.
 *
 * ⚠️ The two escalations are NOT the same message and must not be merged:
 *   - `reminder_escalated`: the partner accepted and then went quiet. The
 *     partner still holds the work; the ask is "chase them".
 *   - `reminder_awaiting_reassignment`: the run is parked and has NO partner.
 *     Nothing will move it without a human choosing one; the ask is
 *     "re-dispatch it". This is the one that let six runs sit for months.
 */

type EscalationEvent =
  | "production_run.reminder_escalated"
  | "production_run.reminder_awaiting_reassignment"

export default async function productionRunEscalationNotifier({
  event,
  container,
}: SubscriberArgs<Record<string, any>>) {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const name = event.name as EscalationEvent
  const runId = event.data?.production_run_id

  if (!runId) {
    return
  }

  try {
    const service: ProductionRunService = container.resolve(PRODUCTION_RUNS_MODULE)
    const run = (await service.retrieveProductionRun(runId).catch(() => null)) as any

    const label = run?.name || runId
    const qty = run?.quantity != null ? ` (${run.quantity} pcs)` : ""

    let title: string
    let description: string

    if (name === "production_run.reminder_awaiting_reassignment") {
      const days = event.data?.parked_days
      const parkedFor =
        typeof days === "number" && days > 0
          ? ` It has been parked for ${days} day${days === 1 ? "" : "s"}.`
          : ""
      const from = event.data?.previous_partner_id
        ? ` It was previously with partner ${event.data.previous_partner_id}.`
        : ""

      title = `Production run parked — needs a partner${
        typeof days === "number" && days > 0 ? ` (${days}d)` : ""
      }`
      description =
        `${label}${qty} is in awaiting_reassignment and has no partner assigned.${parkedFor}${from} ` +
        `Nothing will move it automatically — re-dispatch it from the run page, ` +
        `or via POST /admin/production-runs/redispatch-parked. ` +
        `This repeats weekly until the run leaves the parked state.`
    } else {
      title = `Production run stalled — partner has gone quiet`
      description =
        `${label}${qty} was accepted by its partner and then stopped progressing. ` +
        `The reminder cap has been reached, so no further reminders will be sent. ` +
        `The partner still holds the work — chase them, or reassign the run if they have dropped it.`
    }

    logger.warn(`[run-escalation] ${title} — ${description}`)

    // Best-effort: a notification-provider outage must not lose the log line
    // above, which is the fallback record that an escalation happened at all.
    try {
      const notificationService: any = container.resolve(Modules.NOTIFICATION)
      await notificationService.createNotifications({
        to: "",
        channel: "feed",
        template: "admin-ui",
        data: { title, description },
      })
    } catch (e: any) {
      logger.warn(
        `[run-escalation] Could not post the admin notification for ${runId}: ${e?.message}`
      )
    }
  } catch (e: any) {
    // Never throw out of a subscriber — a failed notification must not retry
    // the event and re-escalate.
    logger.error(`[run-escalation] Error handling ${name} for ${runId}: ${e?.message}`)
  }
}

export const config: SubscriberConfig = {
  event: [
    "production_run.reminder_escalated",
    "production_run.reminder_awaiting_reassignment",
  ],
}
