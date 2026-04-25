import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PRODUCTION_RUNS_MODULE } from "../modules/production_runs"
import type ProductionRunService from "../modules/production_runs/service"
import { TEMPLATE_NAMES } from "../scripts/whatsapp-templates/partner-run-templates"

/**
 * Records every `production_run.*` event we care about as a first-class
 * `production_run_activity` row so the run timeline can be rendered without
 * stuffing arrays into `production_run.metadata`.
 *
 * Two activity types today:
 *   - lifecycle_event  — sent_to_partner / accepted / started / finished /
 *                         completed / cancelled
 *   - reminder_sent    — assignment_pending / not_started / idle
 *
 * For reminder events the row is written at event-emission time, before
 * the existing wildcard WhatsApp flow finishes the actual Meta send. The
 * row captures intent (we *attempted* a reminder); the actual delivery
 * status lives in `messaging_message` — correlate via context_id which
 * carries the per-day suffix `<run_id>:reminder:YYYY-MM-DD`.
 */

type EventName =
  | "production_run.sent_to_partner"
  | "production_run.accepted"
  | "production_run.started"
  | "production_run.finished"
  | "production_run.completed"
  | "production_run.cancelled"
  | "production_run.reminder_assignment_pending"
  | "production_run.reminder_not_started"
  | "production_run.reminder_idle"

type ReminderKind = "assignment_pending" | "not_started" | "idle"

const REMINDER_TEMPLATE_BY_KIND: Record<ReminderKind, string> = {
  assignment_pending: TEMPLATE_NAMES.RUN_REMINDER_PENDING,
  not_started: TEMPLATE_NAMES.RUN_REMINDER_NOT_STARTED,
  idle: TEMPLATE_NAMES.RUN_REMINDER_IDLE,
}

const REMINDER_SUMMARY_BY_KIND: Record<ReminderKind, string> = {
  assignment_pending: "Reminder sent: assignment pending",
  not_started: "Reminder sent: not started",
  idle: "Reminder sent: in-progress run idle",
}

const LIFECYCLE_SUMMARY_BY_KIND: Record<string, string> = {
  sent_to_partner: "Run sent to partner",
  accepted: "Partner accepted the run",
  started: "Partner started the run",
  finished: "Partner marked the run finished",
  completed: "Run completed",
  cancelled: "Run cancelled",
}

export default async function productionRunActivityRecorder({
  event,
  container,
}: SubscriberArgs<Record<string, any>>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const eventName = event.name as EventName
  const eventData = (event.data || {}) as Record<string, any>

  const productionRunId =
    eventData.production_run_id ||
    eventData.id ||
    eventData.production_run?.id ||
    null

  if (!productionRunId) {
    return
  }

  const partnerId = eventData.partner_id || eventData.production_run?.partner_id || null
  const occurredAt = new Date()

  let activityType: "reminder_sent" | "lifecycle_event"
  let kind: string
  let summary: string
  let templateName: string | null = null
  let payload: Record<string, any> | null = null

  if (eventName.startsWith("production_run.reminder_")) {
    const reminderKind = eventName.replace("production_run.reminder_", "") as ReminderKind
    if (!REMINDER_TEMPLATE_BY_KIND[reminderKind]) {
      return
    }
    activityType = "reminder_sent"
    kind = reminderKind
    summary = REMINDER_SUMMARY_BY_KIND[reminderKind]
    templateName = REMINDER_TEMPLATE_BY_KIND[reminderKind]
    payload = {
      reminder_kind: reminderKind,
      design_id: eventData.design_id ?? null,
    }
  } else {
    const lifecycleKind = eventName.replace("production_run.", "")
    if (!LIFECYCLE_SUMMARY_BY_KIND[lifecycleKind]) {
      return
    }
    activityType = "lifecycle_event"
    kind = lifecycleKind
    summary = LIFECYCLE_SUMMARY_BY_KIND[lifecycleKind]
    payload = pickLifecyclePayload(eventData)
  }

  try {
    const service: ProductionRunService = container.resolve(PRODUCTION_RUNS_MODULE)

    await service.createProductionRunActivities({
      production_run_id: productionRunId,
      activity_type: activityType,
      kind,
      actor_type: activityType === "reminder_sent" ? "scheduled_flow" : "system",
      actor_id: null,
      partner_id: partnerId,
      channel: activityType === "reminder_sent" ? "whatsapp" : null,
      message_id: null,
      template_name: templateName,
      recipient: null,
      summary,
      payload,
      occurred_at: occurredAt,
    } as any)
  } catch (e: any) {
    logger.error(
      `[production-run-activity-recorder] failed to write activity for ${eventName} run=${productionRunId}: ${e?.message}`
    )
  }
}

function pickLifecyclePayload(data: Record<string, any>): Record<string, any> | null {
  const out: Record<string, any> = {}
  const keep = [
    "design_id",
    "produced_quantity",
    "rejected_quantity",
    "rejection_reason",
    "notes",
    "reason",
    "cancelled_reason",
  ]
  for (const k of keep) {
    if (data[k] !== undefined && data[k] !== null) {
      out[k] = data[k]
    }
  }
  return Object.keys(out).length ? out : null
}

export const config: SubscriberConfig = {
  event: [
    "production_run.sent_to_partner",
    "production_run.accepted",
    "production_run.started",
    "production_run.finished",
    "production_run.completed",
    "production_run.cancelled",
    "production_run.reminder_assignment_pending",
    "production_run.reminder_not_started",
    "production_run.reminder_idle",
  ],
}
