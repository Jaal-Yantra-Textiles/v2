// Pure, side-effect-free helpers for the unanswered-feedback reminder job (#450).
// Kept free of Medusa/container deps so the "is this reminder due?" selection,
// idempotency guard and email-data assembly are unit-testable without booting
// Medusa, a DB, or a notification provider.
//
// Pairs with the `feedback-reminder` email template seeded in
// `seed-reengagement-email-templates.ts` and reuses the same store-base /
// feedback-url helpers as the original post-delivery request (#452).
import { buildFeedbackUrl } from "./post-delivery-feedback"

export interface FeedbackReminderRow {
  id: string
  status?: string | null
  order_id?: string | null
  submitted_at?: Date | string | null
  deleted_at?: Date | string | null
  metadata?: Record<string, any> | null
}

export interface SelectFeedbackRemindersOptions {
  /** Reference "now" — defaults to a fresh Date. */
  now?: Date
  /** Minimum age (days) since the request before a reminder is sent. */
  minAgeDays?: number
  /** Cap on how many reminders one run will send. */
  maxBatch?: number
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Has a reminder already been sent for this feedback row? We stamp
 * `metadata.reminder_sent_at` after a successful send, so its presence is the
 * idempotency guard (a re-run must never double-nudge the customer).
 */
export function feedbackReminderAlreadySent(row: FeedbackReminderRow): boolean {
  return !!row?.metadata?.reminder_sent_at
}

/**
 * Select the pending post-delivery feedback requests that are now due for a
 * reminder: still `pending`, originated from a post-delivery request, older
 * than `minAgeDays`, not soft-deleted, and not already reminded. Sorted oldest
 * first and capped at `maxBatch`.
 */
export function selectFeedbackRemindersDue(
  feedbacks: FeedbackReminderRow[] | null | undefined,
  options: SelectFeedbackRemindersOptions = {}
): FeedbackReminderRow[] {
  const now = options.now ?? new Date()
  const minAgeDays = options.minAgeDays ?? 5
  const maxBatch = options.maxBatch ?? 100
  if (!Array.isArray(feedbacks) || feedbacks.length === 0) {
    return []
  }

  const cutoff = now.getTime() - minAgeDays * MS_PER_DAY

  const due = feedbacks
    .filter((f) => {
      if (!f || !f.id || f.deleted_at) {
        return false
      }
      if ((f.status ?? "pending") !== "pending") {
        return false
      }
      if (f.metadata?.source !== "post_delivery_request") {
        return false
      }
      if (feedbackReminderAlreadySent(f)) {
        return false
      }
      const submitted = f.submitted_at ? new Date(f.submitted_at).getTime() : NaN
      if (Number.isNaN(submitted)) {
        return false
      }
      return submitted <= cutoff
    })
    .sort((a, b) => {
      const at = new Date(a.submitted_at as any).getTime()
      const bt = new Date(b.submitted_at as any).getTime()
      return at - bt
    })

  return due.slice(0, Math.max(0, maxBatch))
}

export interface FeedbackReminderEmailOrder {
  id?: string | null
  display_id?: number | string | null
  email?: string | null
}

export interface FeedbackReminderEmailInput {
  order: FeedbackReminderEmailOrder
  customerName?: string | null
  feedbackId: string
  storeBase: string
  now?: Date
}

export interface FeedbackReminderEmail {
  /** Recipient — "" when the order has no email (send is then skipped). */
  to: string
  template: "feedback-reminder"
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
 * Assemble the Handlebars data for the `feedback-reminder` template.
 * Mirrors the variables seeded in `seed-reengagement-email-templates.ts`.
 */
export function buildFeedbackReminderEmailData(
  input: FeedbackReminderEmailInput
): FeedbackReminderEmail {
  const { order, customerName, feedbackId, storeBase } = input
  const now = input.now ?? new Date()
  const displayId =
    order?.display_id !== undefined &&
    order?.display_id !== null &&
    `${order.display_id}` !== ""
      ? `#${order.display_id}`
      : order?.id || ""

  return {
    to: (order?.email || "").trim(),
    template: "feedback-reminder",
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
