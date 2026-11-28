import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { FEEDBACK_MODULE } from "../../../../modules/feedback"
import { requestPostDeliveryFeedbackWorkflow } from "../../../../workflows/feedback/request-post-delivery-feedback"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"
import { parseOrderIds, planFeedbackSend } from "./send-post-delivery-feedback-lib"

const MAX_ORDERS = 50

/**
 * Send the post-delivery feedback email for orders the operator names — for
 * orders delivered before the delivery trigger existed, or whose earlier link
 * was broken (cicilabel had no /feedback page until #2689).
 *
 * Runs the SAME workflow the delivery.created subscriber runs, so an order
 * that already has a feedback request reuses that link; one without gets a
 * new request. Skips: no email, no_notification, nothing delivered, already
 * answered. Explicit ids only — never a sweep — because every apply emails a
 * customer and an email cannot be recalled.
 */
export const sendPostDeliveryFeedbackJob: MaintenanceJob = {
  id: "send-post-delivery-feedback",
  label: "Send post-delivery feedback email",
  description:
    `Email the post-delivery feedback link for the named orders (comma-separated order ids, max ${MAX_ORDERS}). Reuses an order's existing feedback link, else creates one. Skips orders with no email, marked no_notification, with nothing delivered, or already answered. EMAILS CUSTOMERS on apply — preview first.`,
  params: [
    {
      name: "order_ids",
      type: "string",
      required: true,
      description: `Comma-separated order ids (order_…), max ${MAX_ORDERS}`,
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const ids = parseOrderIds(params.order_ids)
    if (!ids.length) {
      throw new Error("order_ids is required")
    }
    if (ids.length > MAX_ORDERS) {
      throw new Error(`At most ${MAX_ORDERS} orders per run (got ${ids.length})`)
    }

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const feedbackService: any = container.resolve(FEEDBACK_MODULE)

    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "email",
        "metadata",
        "fulfillments.id",
        "fulfillments.delivered_at",
        "fulfillments.canceled_at",
      ],
      filters: { id: ids },
    })
    const byId = new Map<string, any>((orders || []).map((o: any) => [o.id, o]))

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    let sent = 0
    let toSend = 0
    let skipped = 0

    for (const id of ids) {
      const order = byId.get(id)
      if (!order) {
        errors.push({ id, message: "order not found" })
        continue
      }
      const feedbacks = await feedbackService.listFeedbacks({ order_id: id })
      const plan = planFeedbackSend(order, feedbacks)
      const label = `#${order.display_id}`

      if (plan.action === "skip") {
        skipped++
        changes.push({ entity: "order", id, field: "feedback_email", after: "skipped", note: `${label}: ${plan.reason}` })
        continue
      }

      toSend++
      const link = plan.existing_feedback_id
        ? `reuses feedback ${plan.existing_feedback_id}`
        : "creates a new feedback request"
      const note = `${label} → ${plan.to}; ${link}; fulfillment ${plan.fulfillment_id}`

      if (dry_run) {
        changes.push({ entity: "order", id, field: "feedback_email", after: "would send", note })
        continue
      }

      try {
        const { result } = await requestPostDeliveryFeedbackWorkflow(container).run({
          input: { shipment_id: plan.fulfillment_id },
        })
        sent++
        changes.push({
          entity: "order",
          id,
          field: "feedback_email",
          after: "sent",
          note: `${note}; feedback ${(result as any)?.feedback?.id ?? "?"}`,
        })
      } catch (e: any) {
        errors.push({ id, message: e?.message ?? String(e) })
      }
    }

    const summary = dry_run
      ? `Would email ${toSend} order(s); ${skipped} skipped; ${errors.length} error(s)`
      : `Emailed ${sent} of ${toSend} order(s); ${skipped} skipped; ${errors.length} error(s)`

    return {
      job_id: sendPostDeliveryFeedbackJob.id,
      dry_run,
      applied: !dry_run && sent > 0,
      summary,
      changes,
      errors,
    }
  },
}
