// Pure planning for the "send post-delivery feedback" maintenance job.
// Decides, per order, whether the feedback email goes out and on which
// delivered fulfillment — no container, so it is unit-testable.

export interface PlanFulfillment {
  id: string
  delivered_at?: string | Date | null
  canceled_at?: string | Date | null
}

export interface PlanFeedback {
  id: string
  status?: string | null
  answered_at?: string | Date | null
  deleted_at?: string | Date | null
}

export interface PlanOrderInput {
  id: string
  display_id?: number | string | null
  email?: string | null
  metadata?: Record<string, any> | null
  fulfillments?: PlanFulfillment[] | null
}

export type FeedbackSendPlan =
  | {
      action: "send"
      order_id: string
      fulfillment_id: string
      to: string
      /** Reused feedback link, or null when the workflow will create one. */
      existing_feedback_id: string | null
    }
  | { action: "skip"; order_id: string; reason: string }

/** Parse "a, b,,c" → ["a","b","c"], de-duplicated, order kept. */
export function parseOrderIds(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? "").split(",")
  const out: string[] = []
  for (const v of list) {
    const id = String(v ?? "").trim()
    if (id && !out.includes(id)) {
      out.push(id)
    }
  }
  return out
}

/** The most recently delivered, non-cancelled fulfillment, or null. */
export function pickDeliveredFulfillment(
  fulfillments: PlanFulfillment[] | null | undefined
): PlanFulfillment | null {
  const delivered = (fulfillments || []).filter(
    (f) => f?.id && f.delivered_at && !f.canceled_at
  )
  if (!delivered.length) {
    return null
  }
  return delivered.reduce((a, b) =>
    new Date(b.delivered_at as any).getTime() > new Date(a.delivered_at as any).getTime() ? b : a
  )
}

export function planFeedbackSend(
  order: PlanOrderInput,
  feedbacks: PlanFeedback[] | null | undefined
): FeedbackSendPlan {
  const to = (order.email || "").trim()
  if (!to) {
    return { action: "skip", order_id: order.id, reason: "order has no email" }
  }
  if (order.metadata?.no_notification) {
    return { action: "skip", order_id: order.id, reason: "order is marked no_notification" }
  }
  const fulfillment = pickDeliveredFulfillment(order.fulfillments)
  if (!fulfillment) {
    return { action: "skip", order_id: order.id, reason: "nothing delivered yet" }
  }
  const live = (feedbacks || []).find((f) => f?.id && !f.deleted_at) || null
  if (live && live.answered_at) {
    return { action: "skip", order_id: order.id, reason: `already answered (${live.id})` }
  }
  return {
    action: "send",
    order_id: order.id,
    fulfillment_id: fulfillment.id,
    to,
    existing_feedback_id: live ? live.id : null,
  }
}
