import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IEventBusModuleService } from "@medusajs/framework/types"

import { notifyPartnerOfWorkOrder } from "../workflows/designs/lib/notify-partner-of-work-order"

/**
 * #2500 — a bundle of designs was sent to a partner → ONE WhatsApp listing
 * every design (`produceDesignsAsWorkOrder` emits this once per batch).
 *
 * Before this, each design's dispatch sent its own `jyt_production_run_assigned_v3`
 * template: Shramdaan's 9-design bundle (#152, 2026-11-02) arrived as 9
 * messages in 8 seconds.
 *
 * 🔑 Nobody is left untold. When the bundle message cannot go out (no
 * WhatsApp thread with the partner yet, no work order, a send error), each
 * design is re-emitted as `production_run.sent_to_partner` with
 * `bundle_fallback: true`, which sends today's per-design template. The
 * timeline (already written from `sent_in_bundle`) skips those, and so does
 * the push when the bundle push already went out.
 *
 * Kill switch: WORK_ORDER_SENT_WHATSAPP=false sends every bundle per design,
 * exactly as before #2500.
 */
type Payload = {
  work_order_id?: string | null
  partner_id?: string
  production_run_ids?: string[]
  /** run id → design id, so a fallback event carries what the flow reads. */
  design_ids_by_run?: Record<string, string | null>
}

export default async function workOrderSentWhatsapp({
  event,
  container,
}: SubscriberArgs<Payload>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const data = event.data || {}
  const partnerId = data.partner_id ? String(data.partner_id) : null
  const runIds = (data.production_run_ids || []).filter(Boolean).map(String)
  if (!partnerId || !runIds.length) {
    return
  }
  const workOrderId = data.work_order_id ? String(data.work_order_id) : null

  let reason: string
  if (process.env.WORK_ORDER_SENT_WHATSAPP === "false") {
    reason = "disabled"
  } else if (!workOrderId) {
    reason = "no_work_order"
  } else {
    try {
      const outcome = await notifyPartnerOfWorkOrder(container as any, {
        work_order_id: workOrderId,
        partner_id: partnerId,
        production_run_ids: runIds,
      })
      if (outcome.sent) {
        logger.info(
          `[work-order-whatsapp] told partner ${partnerId} about ${runIds.length} design(s) on ${workOrderId} via ${outcome.via}${outcome.truncated ? " (truncated)" : ""}`
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
    `[work-order-whatsapp] bundle message not sent for ${workOrderId ?? "(no work order)"} (${reason}) — sending ${runIds.length} per-design message(s) instead`
  )
  try {
    const eventBus = container.resolve(Modules.EVENT_BUS) as IEventBusModuleService
    await eventBus.emit(
      runIds.map((runId) => ({
        name: "production_run.sent_to_partner",
        data: {
          production_run_id: runId,
          partner_id: partnerId,
          design_id: data.design_ids_by_run?.[runId] ?? null,
          bundle_fallback: true,
          // The bundle push went out exactly when there is a work order.
          bundle_push_sent: Boolean(workOrderId),
        },
      }))
    )
  } catch (e: any) {
    // The runs WERE sent; a failed courtesy message must not make it look otherwise.
    logger.error(
      `[work-order-whatsapp] per-design fallback failed for ${workOrderId ?? "(no work order)"} → ${partnerId}: ${e?.message || String(e)}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "work_order.sent_to_partner",
}
