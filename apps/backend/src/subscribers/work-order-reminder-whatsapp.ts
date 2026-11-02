import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IEventBusModuleService } from "@medusajs/framework/types"

import { createPartnerNotification } from "../lib/notifications/create-partner-notification"
import { remindPartnerOfWorkOrder } from "../workflows/designs/lib/notify-partner-of-work-order"
import type { PartnerReminderKind } from "../workflows/production-runs/lib/run-bundle"

/**
 * #2500 — a design of a bundle is due its daily reminder → ONE WhatsApp and
 * ONE push for the bundle, listing every design due the same reminder.
 *
 * Before, each design got its own reminder template and push: a 9-design
 * bundle nobody accepted could send 9 a day. Counting, the cap and
 * reassignment are unchanged and still per design (emit-production-run-reminder).
 *
 * 🔑 Nobody is left unreminded. When the bundle message cannot go out (no
 * WhatsApp thread, a send error, the bundle dissolved), THIS design gets
 * today's per-design reminder: `production_run.reminder_<kind>` with
 * `bundle_fallback: true`. Its timeline row is already written, so the
 * recorder skips it.
 *
 * Kill switch: WORK_ORDER_REMINDER_WHATSAPP=false reminds every design on its
 * own, exactly as before #2500.
 */
type Payload = {
  production_run_id?: string
  partner_id?: string
  design_id?: string | null
  reminder_kind?: PartnerReminderKind
  reminder_count?: number
  work_order_id?: string | null
}

const KINDS = new Set<PartnerReminderKind>(["assignment_pending", "not_started", "idle"])

const PUSH_TITLE: Record<PartnerReminderKind, string> = {
  assignment_pending: "Designs are waiting for you",
  not_started: "Accepted designs haven't started",
  idle: "Your designs have been quiet",
}

/**
 * The scheduled flow triggers a bundle's reminders back to back. The first
 * sends and the rest must find its message, so per bundle-day they run one at
 * a time in this process instead of racing the "already sent?" check.
 */
const inFlight = new Map<string, Promise<unknown>>()
const serially = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
  const prev = inFlight.get(key) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(fn)
  inFlight.set(key, next)
  try {
    return await next
  } finally {
    if (inFlight.get(key) === next) inFlight.delete(key)
  }
}

export default async function workOrderReminderWhatsapp({
  event,
  container,
}: SubscriberArgs<Payload>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const data = event.data || {}
  const runId = data.production_run_id ? String(data.production_run_id) : null
  const partnerId = data.partner_id ? String(data.partner_id) : null
  const kind = data.reminder_kind
  if (!runId || !partnerId || !kind || !KINDS.has(kind)) {
    return
  }
  const workOrderId = data.work_order_id ? String(data.work_order_id) : null
  const day = new Date().toISOString().slice(0, 10)

  // The push leg: one per bundle, kind and day, whatever WhatsApp does.
  if (workOrderId) {
    try {
      await createPartnerNotification(container, {
        partner_id: partnerId,
        title: PUSH_TITLE[kind],
        description: "Open the order to see which designs.",
        url: `/orders/${workOrderId}`,
        resource_type: "order",
        resource_id: workOrderId,
        trigger_type: event.name,
        idempotency_key: `reminder:${workOrderId}:${kind}:${day}:${partnerId}`,
        // Phones open a run, not an order, until they have a bundle screen.
        data: { order_id: workOrderId, production_run_id: runId, reminder_kind: kind },
      })
    } catch (e: any) {
      logger.error(`[work-order-reminder] push failed for ${workOrderId} → ${partnerId}: ${e?.message}`)
    }
  }

  let reason: string
  if (process.env.WORK_ORDER_REMINDER_WHATSAPP === "false") {
    reason = "disabled"
  } else {
    try {
      const outcome = await serially(`${workOrderId ?? runId}:${kind}:${day}`, () =>
        remindPartnerOfWorkOrder(container as any, {
          production_run_id: runId,
          partner_id: partnerId,
          reminder_kind: kind,
        })
      )
      if (outcome.sent) {
        logger.info(
          `[work-order-reminder] reminded partner ${partnerId} of ${(outcome as any).listed} design(s) on ${(outcome as any).work_order_id} (${kind}) via ${outcome.via}`
        )
        return
      }
      if (outcome.reason === "already_notified") {
        return
      }
      reason = outcome.reason
    } catch (e: any) {
      reason = e?.message || String(e)
    }
  }

  logger.warn(
    `[work-order-reminder] bundle reminder not sent for run ${runId} (${reason}) — sending its own reminder instead`
  )
  try {
    const eventBus = container.resolve(Modules.EVENT_BUS) as IEventBusModuleService
    await eventBus.emit({
      name: `production_run.reminder_${kind}`,
      data: {
        production_run_id: runId,
        partner_id: partnerId,
        design_id: data.design_id ?? null,
        reminder_kind: kind,
        reminder_count: data.reminder_count ?? null,
        bundle_fallback: true,
      },
    })
  } catch (e: any) {
    logger.error(`[work-order-reminder] per-design fallback failed for ${runId}: ${e?.message || String(e)}`)
  }
}

export const config: SubscriberConfig = {
  event: "production_run.reminder_in_bundle",
}
