import { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { INotificationModuleService } from "@medusajs/types"
import { EMAIL_PROVIDER_MANAGER_MODULE } from "../modules/email-provider-manager"
import EmailProviderManagerService from "../modules/email-provider-manager/service"
import { sendMailjetBulk, BulkEmailEntry } from "../workflows/blogs/send-blog-subscribers/utils/mailjet-bulk-send"

const MAX_ATTEMPTS = 3

/**
 * Process Email Queue Job
 *
 * Runs daily at 6 AM to send queued/overflow emails that couldn't be sent
 * the previous day due to daily provider limits.
 *
 * - Picks up pending queue entries scheduled for today or earlier
 * - Distributes across providers based on current daily capacity
 * - Uses Mailjet bulk API for Mailjet-allocated emails
 * - Sends via notification module for Resend-allocated emails
 * - Reschedules any remaining overflow to the next day
 * - Marks entries as "failed" after MAX_ATTEMPTS (3) retries
 */
export default async function processEmailQueue(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const notificationService = container.resolve(Modules.NOTIFICATION) as INotificationModuleService

  let providerManager: EmailProviderManagerService
  try {
    providerManager = container.resolve(EMAIL_PROVIDER_MANAGER_MODULE)
  } catch {
    logger.warn("[Email Queue] Provider manager not available, skipping")
    return
  }

  logger.info("[Email Queue] Starting queue processing...")

  const today = new Date().toISOString().split("T")[0]

  // Fetch pending entries scheduled for today or earlier
  const pendingEntries = await providerManager.listEmailQueues(
    { status: "pending", scheduled_for: { $lte: today } } as any,
    { take: 500, order: { scheduled_for: "ASC" } }
  ) as any[]

  if (pendingEntries.length === 0) {
    logger.info("[Email Queue] No pending emails to process")
    return
  }

  logger.info(`[Email Queue] Found ${pendingEntries.length} pending emails`)

  // Mark as processing to prevent concurrent runs from picking them up
  for (const entry of pendingEntries) {
    await providerManager.updateEmailQueues({
      id: entry.id,
      status: "processing",
    })
  }

  // Distribute across providers
  const emailAddresses = pendingEntries.map((e) => e.to_email)
  const { allocations, overflow: overflowEmails } = await providerManager.distributeEmails(emailAddresses)

  logger.info(
    `[Email Queue] Distribution: ${allocations.map((a) => `${a.provider}: ${a.emails.length}`).join(", ")}` +
    (overflowEmails.length > 0 ? ` | Overflow: ${overflowEmails.length}` : "")
  )

  // Build lookup: email -> queue entry
  const emailToEntry = new Map<string, any>()
  for (const entry of pendingEntries) {
    emailToEntry.set(entry.to_email, entry)
  }

  let sentCount = 0
  let failedCount = 0

  // --- Mailjet bulk sending + notification record creation ---
  const mailjetAllocation = allocations.find((a) => a.provider === "mailjet")
  if (mailjetAllocation && mailjetAllocation.emails.length > 0) {
    const bulkEntries: BulkEmailEntry[] = []

    for (const email of mailjetAllocation.emails) {
      const entry = emailToEntry.get(email)
      if (!entry) continue

      let data: any
      try {
        data = JSON.parse(entry.data)
      } catch {
        data = {}
      }

      bulkEntries.push({
        to: email,
        subject: data.subject || data._template_subject || "Blog Newsletter",
        htmlContent: data.blog_content || data._template_html_content || "No content",
      })
    }

    // Send via Mailjet bulk API (efficient batches of 50)
    const bulkResult = await sendMailjetBulk(bulkEntries)

    // Create notification records for successful sends (provider skips re-sending)
    for (const sent of bulkResult.successful) {
      const entry = emailToEntry.get(sent.email)
      if (!entry) continue

      let data: any
      try {
        data = JSON.parse(entry.data)
      } catch {
        data = {}
      }

      try {
        await notificationService.createNotifications({
          to: sent.email,
          channel: "email_bulk",
          template: entry.template,
          data: {
            ...data,
            _already_sent: true,
            _external_id: sent.messageId,
            _mailjet_response: {
              message_id: sent.messageId,
              message_uuid: sent.messageUuid,
              status: sent.status,
            },
          },
        })
      } catch (err) {
        logger.warn(`[Email Queue] Failed to create notification record for ${sent.email}: ${err.message}`)
      }

      await providerManager.updateEmailQueues({ id: entry.id, status: "sent" })
      sentCount++
    }

    for (const fail of bulkResult.failed) {
      const entry = emailToEntry.get(fail.email)
      if (entry) {
        const newAttempts = (entry.attempts || 0) + 1
        if (newAttempts >= MAX_ATTEMPTS) {
          await providerManager.updateEmailQueues({
            id: entry.id,
            status: "failed",
            attempts: newAttempts,
            last_error: fail.error,
          })
          failedCount++
        } else {
          await providerManager.updateEmailQueues({
            id: entry.id,
            status: "pending",
            attempts: newAttempts,
            last_error: fail.error,
            scheduled_for: providerManager.getNextDate(),
          })
        }
      }
    }

    try {
      await providerManager.recordUsage("mailjet", bulkResult.successful.length)
    } catch (err) {
      logger.warn(`[Email Queue] Failed to record Mailjet usage: ${err.message}`)
    }
  }

  // --- Resend one-at-a-time sending ---
  const resendAllocation = allocations.find((a) => a.provider === "resend")
  if (resendAllocation && resendAllocation.emails.length > 0) {
    for (const email of resendAllocation.emails) {
      const entry = emailToEntry.get(email)
      if (!entry) continue

      let data: any
      try {
        data = JSON.parse(entry.data)
      } catch {
        data = {}
      }

      try {
        await notificationService.createNotifications({
          to: email,
          channel: "email",
          template: entry.template,
          data,
        })

        await providerManager.updateEmailQueues({ id: entry.id, status: "sent" })
        sentCount++
      } catch (error) {
        const newAttempts = (entry.attempts || 0) + 1
        if (newAttempts >= MAX_ATTEMPTS) {
          await providerManager.updateEmailQueues({
            id: entry.id,
            status: "failed",
            attempts: newAttempts,
            last_error: error.message,
          })
          failedCount++
        } else {
          await providerManager.updateEmailQueues({
            id: entry.id,
            status: "pending",
            attempts: newAttempts,
            last_error: error.message,
            scheduled_for: providerManager.getNextDate(),
          })
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    try {
      const resendSent = resendAllocation.emails.length -
        (await providerManager.listEmailQueues(
          { status: "failed", to_email: { $in: resendAllocation.emails } } as any,
          { take: 500 }
        )).length
      if (resendSent > 0) {
        await providerManager.recordUsage("resend", resendSent)
      }
    } catch (err) {
      logger.warn(`[Email Queue] Failed to record Resend usage: ${err.message}`)
    }
  }

  // --- Reschedule overflow to tomorrow ---
  if (overflowEmails.length > 0) {
    const nextDate = providerManager.getNextDate()
    let rescheduled = 0

    for (const email of overflowEmails) {
      const entry = emailToEntry.get(email)
      if (!entry) continue

      const newAttempts = (entry.attempts || 0) + 1
      if (newAttempts >= MAX_ATTEMPTS) {
        await providerManager.updateEmailQueues({
          id: entry.id,
          status: "failed",
          attempts: newAttempts,
          last_error: "Exceeded max attempts — daily limits consistently full",
        })
        failedCount++
      } else {
        await providerManager.updateEmailQueues({
          id: entry.id,
          status: "pending",
          attempts: newAttempts,
          scheduled_for: nextDate,
        })
        rescheduled++
      }
    }

    logger.info(`[Email Queue] Rescheduled ${rescheduled} emails to ${nextDate}`)
  }

  logger.info(
    `[Email Queue] Complete: ${sentCount} sent, ${failedCount} failed permanently`
  )
}

export const config = {
  name: "process-email-queue",
  schedule: "0 6 * * *", // Every day at 6 AM
}
