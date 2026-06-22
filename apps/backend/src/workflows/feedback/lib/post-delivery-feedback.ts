// Pure, side-effect-free helpers for the post-delivery feedback request (#452).
// Kept free of Medusa/container deps so the request/skip decision, idempotency
// selection, store-base resolution and email-data assembly are unit-testable
// without booting Medusa or a notification provider.

export interface FeedbackRequestDecisionInput {
  order?: {
    metadata?: Record<string, any> | null
  } | null
  /** `no_notification` flag carried on the delivery.created event payload. */
  eventNoNotification?: boolean | null
}

export interface FeedbackRequestDecision {
  request: boolean
  /** Human-readable reason a request was skipped (for the subscriber log). */
  reason?: string
}

/**
 * Decide whether to create a post-delivery feedback request + email.
 * Honours the same `no_notification` skip semantics the delivery/shipment
 * emails use: an explicit flag on the event OR `metadata.no_notification`
 * on the order suppresses the touchpoint.
 *
 * Note: a missing customer email does NOT skip the request — the feedback
 * record is still created (durable, can be surfaced in-app later); only the
 * email send is guarded separately on a present recipient.
 */
export function shouldRequestPostDeliveryFeedback(
  input: FeedbackRequestDecisionInput
): FeedbackRequestDecision {
  if (input.eventNoNotification) {
    return { request: false, reason: "no_notification flag on event" }
  }
  if (input.order?.metadata?.no_notification) {
    return { request: false, reason: "no_notification flag on order metadata" }
  }
  return { request: true }
}

export interface ExistingFeedbackLike {
  id: string
  order_id?: string | null
  deleted_at?: Date | string | null
}

/**
 * Idempotency selector: given the existing feedback rows for an order, return
 * the one that already represents a request (so we reuse it) or `null` when a
 * new request should be created. Ignores soft-deleted rows.
 */
export function selectExistingFeedbackRequest(
  existing: ExistingFeedbackLike[] | null | undefined
): ExistingFeedbackLike | null {
  if (!Array.isArray(existing) || existing.length === 0) {
    return null
  }
  const live = existing.find((f) => f && f.id && !f.deleted_at)
  return live ?? null
}

/**
 * Resolve the storefront base URL used to build the feedback link.
 * Precedence: explicit override → STORE_URL → FRONTEND_URL → "".
 * Returns a trailing-slash-trimmed string (or "" when none configured).
 */
export function resolveFeedbackStoreBase(
  env: Record<string, string | undefined> = {},
  override?: string | null
): string {
  const raw = (override || env.STORE_URL || env.FRONTEND_URL || "").trim()
  return raw.replace(/\/+$/, "")
}

/**
 * Build the customer-facing feedback URL. Returns "" when no store base is
 * configured (the email template hides the CTA when `feedback_url` is falsy).
 */
export function buildFeedbackUrl(storeBase: string, feedbackId: string): string {
  const base = (storeBase || "").replace(/\/+$/, "")
  if (!base || !feedbackId) {
    return ""
  }
  return `${base}/feedback/${feedbackId}`
}

export interface PostDeliveryFeedbackEmailOrder {
  id?: string | null
  display_id?: number | string | null
  email?: string | null
}

export interface PostDeliveryFeedbackEmailInput {
  order: PostDeliveryFeedbackEmailOrder
  customerName?: string | null
  feedbackId: string
  storeBase: string
  now?: Date
}

export interface PostDeliveryFeedbackEmail {
  /** Recipient — may be "" when the order has no email (send is then skipped). */
  to: string
  template: "order-feedback-request"
  data: {
    customer_name: string
    order_id: string
    order_display: string
    feedback_url: string
    store_url: string
    current_year: number
    feedback_id: string
  }
}

/**
 * Assemble the Handlebars data for the `order-feedback-request` template.
 * Mirrors the variables seeded in `seed-additional-email-templates.ts` (#450).
 */
export function buildPostDeliveryFeedbackEmailData(
  input: PostDeliveryFeedbackEmailInput
): PostDeliveryFeedbackEmail {
  const { order, customerName, feedbackId, storeBase } = input
  const now = input.now ?? new Date()
  const displayId =
    order?.display_id !== undefined && order?.display_id !== null && `${order.display_id}` !== ""
      ? `#${order.display_id}`
      : order?.id || ""

  return {
    to: (order?.email || "").trim(),
    template: "order-feedback-request",
    data: {
      customer_name: (customerName || "").trim() || "there",
      order_id: order?.id || "",
      order_display: displayId,
      feedback_url: buildFeedbackUrl(storeBase, feedbackId),
      store_url: storeBase,
      current_year: now.getFullYear(),
      feedback_id: feedbackId,
    },
  }
}
