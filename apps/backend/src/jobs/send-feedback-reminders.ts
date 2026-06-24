import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { FEEDBACK_MODULE } from "../modules/feedback"
import type FeedbackService from "../modules/feedback/service"
import { sendNotificationEmailWorkflow } from "../workflows/email/workflows/send-notification-email"
import { resolveFeedbackStoreBase } from "../workflows/feedback/lib/post-delivery-feedback"
import {
  buildFeedbackReminderEmailData,
  selectFeedbackRemindersDue,
} from "../workflows/feedback/lib/feedback-reminder"

/**
 * #450 — feedback reminder nudge.
 *
 * Finds post-delivery feedback requests (#452) that are still `pending` after
 * N days with no reminder yet sent, and emails the customer the
 * `feedback-reminder` template. Idempotent: each row is stamped with
 * `metadata.reminder_sent_at` after a successful send so a re-run never
 * double-nudges. Best-effort — a missing template / order / provider error for
 * one row never aborts the batch.
 *
 * Detection lives entirely in the feedback module's own data (the durable
 * `order_id` + `metadata.source` written by `request-post-delivery-feedback`),
 * so no extra tracking infrastructure is needed.
 */
const MIN_AGE_DAYS = Number(process.env.FEEDBACK_REMINDER_MIN_AGE_DAYS || 5)
const MAX_BATCH = Number(process.env.FEEDBACK_REMINDER_MAX_BATCH || 100)

export default async function sendFeedbackReminders(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const feedbackService = container.resolve(FEEDBACK_MODULE) as FeedbackService

  try {
    // Pull the pending request rows; the pure selector applies the age /
    // idempotency / source filters so this stays unit-testable.
    const pending = await feedbackService.listFeedbacks(
      { status: "pending" },
      { take: 1000 }
    )

    const due = selectFeedbackRemindersDue(pending as any, {
      minAgeDays: MIN_AGE_DAYS,
      maxBatch: MAX_BATCH,
    })

    if (due.length === 0) {
      return
    }

    const storeBase = resolveFeedbackStoreBase(
      process.env as Record<string, string | undefined>
    )

    let sent = 0
    let skipped = 0
    for (const row of due) {
      try {
        if (!row.order_id) {
          skipped++
          continue
        }

        const { data: orderRows } = await query.graph({
          entity: "order",
          fields: ["id", "display_id", "email"],
          filters: { id: row.order_id },
        })
        const order: any = orderRows?.[0]
        if (!order) {
          skipped++
          continue
        }

        const email = buildFeedbackReminderEmailData({
          order,
          customerName: order.email || "",
          feedbackId: row.id,
          storeBase,
        })

        // No recipient → can't nudge; leave unstamped so a later run can retry
        // once the order has an email.
        if (!email.to) {
          skipped++
          continue
        }

        await sendNotificationEmailWorkflow(container).run({
          input: {
            to: email.to,
            template: email.template,
            data: email.data,
          },
        })

        // Stamp idempotency marker (preserve existing metadata).
        await feedbackService.updateFeedbacks({
          id: row.id,
          metadata: {
            ...(row.metadata || {}),
            reminder_sent_at: new Date().toISOString(),
          },
        })
        sent++
      } catch (e: any) {
        skipped++
        logger.warn(
          `[feedback-reminder] failed for feedback ${row.id}: ${e?.message || e}`
        )
      }
    }

    if (sent + skipped > 0) {
      logger.info(`[feedback-reminder] done — sent=${sent} skipped=${skipped}`)
    }
  } catch (e: any) {
    logger.error(`[feedback-reminder] batch error: ${e?.message || e}`)
  }
}

export const config = {
  name: "send-feedback-reminders",
  schedule: "0 10 * * *", // Daily at 10:00
}
