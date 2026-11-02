import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { createPartnerNotification } from "../lib/notifications/create-partner-notification"

/**
 * Work SENT to a partner → a bell row and a push on their phone.
 *
 * Until now the only partner push was the run reminder: a design run or an
 * inventory order reached the partner over WhatsApp (where one is set up) and
 * nowhere in the app. The push is the app's leg of the same moment, so a
 * partner who lives in the app still hears about new work.
 *
 * - `production_run.sent_to_partner` — a design run dispatched to the partner
 *   (send-to-production, produce, dependency release, auto-dispatch). Opens
 *   the run.
 * - `work_order.sent_to_partner` — a bundle of designs (#2500). One push for
 *   the bundle, opening the work order; its designs' own pushes are skipped.
 * - `inventory_order_assigned_to_partner` — only `send-to-partner` emits it;
 *   `assign-partner` stays silent by design. Opens the order.
 *
 * The device reads only the flat `data` map, so the ids it routes on go there.
 * Idempotency is per run / per order: a redelivered event must not ring twice.
 *
 * Kill switch: PARTNER_PUSH_ON_SEND=false.
 */
export default async function partnerPushOnSend({
  event,
  container,
}: SubscriberArgs<Record<string, any>>) {
  if (process.env.PARTNER_PUSH_ON_SEND === "false") {
    return
  }
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const data = event.data || {}
  const partnerId = data.partner_id ? String(data.partner_id) : null
  if (!partnerId) {
    return
  }

  try {
    if (event.name === "work_order.sent_to_partner") {
      // #2500 — one push for the whole bundle, opening the work order.
      const workOrderId = data.work_order_id ? String(data.work_order_id) : null
      const runIds = ((data.production_run_ids as any[]) || []).filter(Boolean).map(String)
      if (!workOrderId || !runIds.length) return
      const count = runIds.length

      await createPartnerNotification(container, {
        partner_id: partnerId,
        title: count === 1 ? "New design to make" : `${count} new designs to make`,
        description: "Open the order to accept the work.",
        url: `/orders/${workOrderId}`,
        resource_type: "order",
        resource_id: workOrderId,
        trigger_type: event.name,
        idempotency_key: `sent-to-partner:${workOrderId}:${[...runIds].sort()[0]}:${partnerId}`,
        // The phone apps open only a run or an inventory order today, so the
        // tap lands on the bundle's first design until they have a bundle
        // screen (#2500, #2238). The web bell uses `url` and opens the order.
        data: { order_id: workOrderId, production_run_id: [...runIds].sort()[0] },
      })
      return
    }

    if (event.name === "production_run.sent_to_partner") {
      const runId = data.production_run_id ? String(data.production_run_id) : null
      if (!runId) return
      // #2500 — a design of a bundle whose push already went out.
      if (data.bundle_push_sent === true) return
      const designId = data.design_id ? String(data.design_id) : null

      let designName: string | null = null
      if (designId) {
        const { data: designs } = await query.graph({
          entity: "design",
          fields: ["id", "name"],
          filters: { id: designId },
        })
        designName = (designs?.[0] as any)?.name ?? null
      }

      await createPartnerNotification(container, {
        partner_id: partnerId,
        title: designName ? `New design: ${designName}` : "New production run",
        description: "Open it to accept the work.",
        url: `/production-runs/${runId}`,
        resource_type: "production_run",
        resource_id: runId,
        trigger_type: event.name,
        idempotency_key: `sent-to-partner:${runId}:${partnerId}`,
        data: { production_run_id: runId, design_id: designId },
      })
      return
    }

    if (event.name === "inventory_order_assigned_to_partner") {
      const orderId = data.inventory_order_id ? String(data.inventory_order_id) : null
      if (!orderId) return

      const { data: orders } = await query.graph({
        entity: "inventory_orders",
        fields: ["id", "orderlines.id"],
        filters: { id: orderId },
      })
      const lines = ((orders?.[0] as any)?.orderlines || []).length

      await createPartnerNotification(container, {
        partner_id: partnerId,
        title: "New inventory order",
        description: lines
          ? `${lines} item${lines === 1 ? "" : "s"}. Open it to confirm the quantities.`
          : "Open it to confirm the quantities.",
        // The partner UI's order page; `/inventory-orders` only redirects to the list.
        url: `/orders/inventory/${orderId}`,
        resource_type: "inventory_order",
        resource_id: orderId,
        trigger_type: event.name,
        idempotency_key: `sent-to-partner:${orderId}:${partnerId}`,
        data: { inventory_order_id: orderId },
      })
    }
  } catch (e: any) {
    // The work WAS sent; a failed courtesy push must not make it look otherwise.
    logger.error(`[partner-push-on-send] ${event.name} → ${partnerId}: ${e?.message || String(e)}`)
  }
}

export const config: SubscriberConfig = {
  event: [
    "production_run.sent_to_partner",
    "inventory_order_assigned_to_partner",
    "work_order.sent_to_partner",
  ],
}
