import { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { INotificationModuleService } from "@medusajs/types"
import { EMAIL_PROVIDER_MANAGER_MODULE } from "../modules/email-provider-manager"
import EmailProviderManagerService from "../modules/email-provider-manager/service"
import { EMAIL_TEMPLATES_MODULE } from "../modules/email_templates"
import EmailTemplatesService from "../modules/email_templates/service"
import { sendMailjetBulk, BulkEmailEntry } from "../modules/mailjet/bulk"
import * as Handlebars from "handlebars"

const MAX_ATTEMPTS = 3

/**
 * Process Email Queue Job
 *
 * Runs daily at 6 AM to send queued/overflow emails that couldn't be sent
 * the previous day due to daily provider limits.
 *
 * - Picks up pending queue entries scheduled for today or earlier
 * - Fetches the email template from DB and renders per-subscriber
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

  // Fetch email templates from DB for all unique template keys in the queue
  const templateCache = new Map<string, { compiledHtml: HandlebarsTemplateDelegate; compiledSubject: HandlebarsTemplateDelegate; from: string }>()
  const uniqueTemplateKeys = [...new Set(pendingEntries.map((e) => e.template))]

  try {
    const emailTemplatesService: EmailTemplatesService = container.resolve(EMAIL_TEMPLATES_MODULE)
    for (const templateKey of uniqueTemplateKeys) {
      try {
        const template = await emailTemplatesService.getTemplateByKey(templateKey)
        templateCache.set(templateKey, {
          compiledHtml: Handlebars.compile(template.html_content),
          compiledSubject: Handlebars.compile(template.subject),
          from: template.from || "",
        })
        logger.info(`[Email Queue] Loaded template "${templateKey}" from database`)
      } catch (err) {
        logger.error(`[Email Queue] Template "${templateKey}" not found — entries using it will fail`)
      }
    }
  } catch (err) {
    logger.error(`[Email Queue] Email templates module not available: ${err.message}`)
  }

  /**
   * Render template for a queue entry's data. Returns the rendered HTML + subject
   * or null if no template is available.
   */
  function renderForEntry(entry: any, data: any): { subject: string; htmlContent: string; from: string } | null {
    // If the data already has _template_* flags, use those
    if (data._template_html_content && data._template_processed) {
      return {
        subject: data._template_subject || data.subject || "Newsletter",
        htmlContent: data._template_html_content,
        from: data._template_from || "",
      }
    }

    // Otherwise, render from the DB template
    const cached = templateCache.get(entry.template)
    if (!cached) return null

    return {
      subject: cached.compiledSubject(data),
      htmlContent: cached.compiledHtml(data),
      from: cached.from,
    }
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

  // --- Mailjet bulk sending ---
  const mailjetAllocation = allocations.find((a) => a.provider === "mailjet")
  if (mailjetAllocation && mailjetAllocation.emails.length > 0) {
    const bulkEntries: BulkEmailEntry[] = []

    for (const email of mailjetAllocation.emails) {
      const entry = emailToEntry.get(email)
      if (!entry) continue

      let data: any
      try { data = JSON.parse(entry.data) } catch { data = {} }

      const rendered = renderForEntry(entry, data)
      bulkEntries.push({
        to: email,
        subject: rendered?.subject || data.subject || "Blog Newsletter",
        htmlContent: rendered?.htmlContent || data.blog_content || "No content",
      })
    }

    const bulkResult = await sendMailjetBulk(bulkEntries)

    for (const sent of bulkResult.successful) {
      const entry = emailToEntry.get(sent.email)
      if (!entry) continue

      let data: any
      try { data = JSON.parse(entry.data) } catch { data = {} }

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
            id: entry.id, status: "failed", attempts: newAttempts, last_error: fail.error,
          })
          failedCount++
        } else {
          await providerManager.updateEmailQueues({
            id: entry.id, status: "pending", attempts: newAttempts, last_error: fail.error,
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
      try { data = JSON.parse(entry.data) } catch { data = {} }

      // Render the template and attach _template_* flags so Resend uses the
      // DB template instead of the default React email component.
      const rendered = renderForEntry(entry, data)
      const notificationData: Record<string, any> = { ...data }
      if (rendered) {
        notificationData._template_subject = rendered.subject
        notificationData._template_html_content = rendered.htmlContent
        notificationData._template_from = rendered.from
        notificationData._template_processed = true
      }

      try {
        await notificationService.createNotifications({
          to: email,
          channel: "email",
          template: entry.template,
          data: notificationData,
        })

        await providerManager.updateEmailQueues({ id: entry.id, status: "sent" })
        sentCount++
      } catch (error) {
        const newAttempts = (entry.attempts || 0) + 1
        if (newAttempts >= MAX_ATTEMPTS) {
          await providerManager.updateEmailQueues({
            id: entry.id, status: "failed", attempts: newAttempts, last_error: error.message,
          })
          failedCount++
        } else {
          await providerManager.updateEmailQueues({
            id: entry.id, status: "pending", attempts: newAttempts, last_error: error.message,
            scheduled_for: providerManager.getNextDate(),
          })
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    try {
      await providerManager.recordUsage("resend", sentCount)
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
          id: entry.id, status: "failed", attempts: newAttempts,
          last_error: "Exceeded max attempts — daily limits consistently full",
        })
        failedCount++
      } else {
        await providerManager.updateEmailQueues({
          id: entry.id, status: "pending", attempts: newAttempts, scheduled_for: nextDate,
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
