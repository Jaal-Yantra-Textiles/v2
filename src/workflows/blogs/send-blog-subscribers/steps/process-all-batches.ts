import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { SubscriberBatch, EmailSendingResult, SendingSummary } from "../types"
import { Modules } from "@medusajs/framework/utils"
import { convertTipTapToHtml } from "../utils/tiptap-to-html"
import { sendMailjetBulk, BulkEmailEntry } from "../utils/mailjet-bulk-send"
import { INotificationModuleService } from "@medusajs/types"
import { EMAIL_PROVIDER_MANAGER_MODULE } from "../../../../modules/email-provider-manager"
import EmailProviderManagerService from "../../../../modules/email-provider-manager/service"
import { EMAIL_TEMPLATES_MODULE } from "../../../../modules/email_templates"
import EmailTemplatesService from "../../../../modules/email_templates/service"
import * as Handlebars from "handlebars"

export const processAllBatchesStepId = "process-all-batches"

const BLOG_TEMPLATE_KEY = "blog-subscriber"

/**
 * Converts blog content to HTML, handling TipTap JSON and plain text formats.
 */
function convertContentToHtml(content: any): string {
  if (typeof content === "object") {
    return convertTipTapToHtml(content)
  }

  if (typeof content === "string") {
    if (content.includes('"type":"doc"') || content.startsWith("{")) {
      try {
        return convertTipTapToHtml(JSON.parse(content))
      } catch {
        return convertTipTapToHtml(content)
      }
    }
    return content
  }

  return String(content || "")
}

/**
 * Builds the email data payload for a subscriber.
 */
function buildEmailData(
  subscriber: { id: string; email: string; first_name?: string; last_name?: string },
  blogData: any,
  htmlContent: string,
  emailConfig: { subject: string; customMessage?: string }
) {
  return {
    blog_title: blogData.title,
    blog_content: htmlContent,
    blog_url: `${process.env.FRONTEND_URL || ""}${blogData.url}`,
    blog_created_at: blogData.created_at,
    blog_updated_at: blogData.updated_at,
    blog_tags: blogData.tags || [],
    first_name: subscriber.first_name || "",
    last_name: subscriber.last_name || "",
    email: subscriber.email,
    subscriber_id: subscriber.id,
    subject: emailConfig.subject,
    custom_message: emailConfig.customMessage || "",
    unsubscribe_url: `${process.env.FRONTEND_URL || ""}/unsubscribe?id=${subscriber.id}`,
    website_url: process.env.FRONTEND_URL || "",
    current_year: new Date().getFullYear().toString(),
    blog: {
      title: blogData.title,
      content: htmlContent,
      url: `${process.env.FRONTEND_URL || ""}${blogData.url}`,
      created_at: blogData.created_at,
      updated_at: blogData.updated_at,
      tags: blogData.tags || [],
    },
    person: {
      first_name: subscriber.first_name || "",
      last_name: subscriber.last_name || "",
      email: subscriber.email,
      id: subscriber.id,
    },
  }
}

// Register Handlebars helpers once
let helpersRegistered = false
function ensureHandlebarsHelpers() {
  if (helpersRegistered) return
  Handlebars.registerHelper("formatDate", function (value: any, options: Handlebars.HelperOptions) {
    try {
      const locale = options?.hash?.locale || "en-US"
      const dateStyle = options?.hash?.dateStyle || "medium"
      const date = new Date(value)
      if (isNaN(date.getTime())) return value ?? ""
      return new Intl.DateTimeFormat(locale, { dateStyle } as any).format(date)
    } catch { return value ?? "" }
  })
  Handlebars.registerHelper("formatYear", (value: any) => {
    const d = new Date(value)
    return isNaN(d.getTime()) ? (value ?? "") : `${d.getFullYear()}`
  })
  Handlebars.registerHelper("capitalize", (value: string) =>
    typeof value === "string" && value.length ? value.charAt(0).toUpperCase() + value.slice(1) : value ?? ""
  )
  helpersRegistered = true
}

/**
 * Process the Handlebars template with subscriber-specific data.
 * Returns { subject, htmlContent, from }.
 */
function renderTemplate(
  compiledHtml: HandlebarsTemplateDelegate,
  compiledSubject: HandlebarsTemplateDelegate,
  from: string,
  data: Record<string, any>
): { subject: string; htmlContent: string; from: string } {
  return {
    subject: compiledSubject(data),
    htmlContent: compiledHtml(data),
    from,
  }
}

/**
 * This step processes all subscriber batches with load distribution across
 * multiple email providers (Resend + Mailjet).
 *
 * - Fetches the blog-subscriber email template from DB once
 * - Renders per-subscriber via Handlebars (personalized subject/content)
 * - Uses Mailjet bulk API (up to 50 per call) for Mailjet-allocated emails
 * - Sends one-at-a-time via notification module for Resend-allocated emails
 * - Queues overflow emails for the next day when daily limits are exceeded
 */
export const processAllBatchesStep = createStep(
  processAllBatchesStepId,
  async (batches: SubscriberBatch[], { container }) => {
    const allResults: EmailSendingResult[] = []
    const notificationModuleService: INotificationModuleService =
      container.resolve(Modules.NOTIFICATION)

    // Resolve the email provider manager for load distribution
    let providerManager: EmailProviderManagerService | null = null
    try {
      providerManager = container.resolve(EMAIL_PROVIDER_MANAGER_MODULE)
    } catch (err) {
      console.warn("Email provider manager not available, falling back to single provider:", err.message)
    }

    // Fetch the blog-subscriber template from DB once
    let compiledHtml: HandlebarsTemplateDelegate | null = null
    let compiledSubject: HandlebarsTemplateDelegate | null = null
    let templateFrom = ""
    try {
      const emailTemplatesService: EmailTemplatesService = container.resolve(EMAIL_TEMPLATES_MODULE)
      const template = await emailTemplatesService.getTemplateByKey(BLOG_TEMPLATE_KEY)
      ensureHandlebarsHelpers()
      compiledHtml = Handlebars.compile(template.html_content)
      compiledSubject = Handlebars.compile(template.subject)
      templateFrom = template.from || ""
      console.log(`Loaded email template "${BLOG_TEMPLATE_KEY}" from database`)
    } catch (err) {
      console.warn(`Failed to load email template "${BLOG_TEMPLATE_KEY}":`, err.message)
    }

    // Collect all subscribers from all batches
    const allSubscribers: {
      subscriber: any
      blogData: any
      emailConfig: { subject: string; customMessage?: string }
    }[] = []

    for (const batch of batches) {
      for (const subscriber of batch.subscribers) {
        allSubscribers.push({
          subscriber,
          blogData: batch.blogData,
          emailConfig: batch.emailConfig,
        })
      }
    }

    const totalEmails = allSubscribers.length
    console.log(`Processing ${totalEmails} subscriber emails`)

    // Pre-compute blog HTML content once (same blog for all subscribers)
    let sharedBlogHtml: string | null = null
    if (allSubscribers.length > 0) {
      try {
        sharedBlogHtml = convertContentToHtml(allSubscribers[0].blogData.content)
      } catch {
        sharedBlogHtml = String(allSubscribers[0].blogData.content || "No content available")
      }
    }

    let queuedCount = 0

    // Build a lookup: email -> subscriber data
    const emailToSubscriber = new Map<string, typeof allSubscribers[0]>()
    for (const entry of allSubscribers) {
      emailToSubscriber.set(entry.subscriber.email, entry)
    }

    /**
     * For a given subscriber, build emailData and render the template.
     * Returns the rendered { subject, htmlContent, from } or null if no template.
     */
    function getRenderedEmail(entry: typeof allSubscribers[0]) {
      const blogHtml = sharedBlogHtml || ""
      const emailData = buildEmailData(entry.subscriber, entry.blogData, blogHtml, entry.emailConfig)

      if (compiledHtml && compiledSubject) {
        return {
          emailData,
          rendered: renderTemplate(compiledHtml, compiledSubject, templateFrom, emailData),
        }
      }

      // No template — emailData will be sent raw (Resend falls back to default template)
      return { emailData, rendered: null }
    }

    if (providerManager) {
      // Get remaining capacity across providers
      const capacities = await providerManager.getRemainingCapacity()
      console.log(
        "Provider capacity:",
        capacities.map((c) => `${c.provider}: ${c.remaining}/${c.limit} remaining`).join(", ")
      )

      // Distribute email addresses across providers
      const emailAddresses = allSubscribers.map((s) => s.subscriber.email)
      const { allocations, overflow } = await providerManager.distributeEmails(emailAddresses)

      console.log(
        "Allocation plan:",
        allocations.map((a) => `${a.provider}: ${a.emails.length} emails`).join(", "),
        overflow.length > 0 ? `| Overflow: ${overflow.length} queued for tomorrow` : ""
      )

      // Build a lookup: email -> provider
      const emailToProvider = new Map<string, string>()
      for (const allocation of allocations) {
        for (const email of allocation.emails) {
          emailToProvider.set(email, allocation.provider)
        }
      }

      // --- Mailjet bulk sending (uses rendered template directly) ---
      const mailjetAllocation = allocations.find((a) => a.provider === "mailjet")
      if (mailjetAllocation && mailjetAllocation.emails.length > 0) {
        console.log(`Sending ${mailjetAllocation.emails.length} emails via Mailjet bulk API`)

        const bulkEntries: BulkEmailEntry[] = []
        for (const email of mailjetAllocation.emails) {
          const entry = emailToSubscriber.get(email)
          if (!entry) continue

          const { rendered } = getRenderedEmail(entry)
          bulkEntries.push({
            to: email,
            subject: rendered?.subject || entry.emailConfig.subject,
            htmlContent: rendered?.htmlContent || sharedBlogHtml || "",
          })
        }

        const bulkResult = await sendMailjetBulk(bulkEntries)

        for (const email of bulkResult.successful) {
          const entry = emailToSubscriber.get(email)
          allResults.push({ success: true, subscriber_id: entry?.subscriber.id || "", email })
        }
        for (const fail of bulkResult.failed) {
          const entry = emailToSubscriber.get(fail.email)
          allResults.push({ success: false, subscriber_id: entry?.subscriber.id || "", email: fail.email, error: fail.error })
        }
      }

      // --- Resend one-at-a-time sending (passes _template_* flags) ---
      const resendAllocation = allocations.find((a) => a.provider === "resend")
      if (resendAllocation && resendAllocation.emails.length > 0) {
        console.log(`Sending ${resendAllocation.emails.length} emails via Resend`)

        for (const email of resendAllocation.emails) {
          const entry = emailToSubscriber.get(email)
          if (!entry) continue

          try {
            const { emailData, rendered } = getRenderedEmail(entry)

            // Attach processed template data so Resend uses the rendered HTML
            const notificationData: Record<string, any> = { ...emailData }
            if (rendered) {
              notificationData._template_subject = rendered.subject
              notificationData._template_html_content = rendered.htmlContent
              notificationData._template_from = rendered.from
              notificationData._template_processed = true
            }

            await notificationModuleService.createNotifications({
              to: email,
              channel: "email",
              template: BLOG_TEMPLATE_KEY,
              data: notificationData,
            })

            allResults.push({ success: true, subscriber_id: entry.subscriber.id, email })
          } catch (error) {
            allResults.push({
              success: false, subscriber_id: entry.subscriber.id, email,
              error: error.message || "Unknown error",
            })
          }

          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      }

      // --- Queue overflow emails for the next day ---
      if (overflow.length > 0) {
        console.log(`Queuing ${overflow.length} overflow emails for tomorrow`)

        const queueEntries = overflow.map((email) => {
          const entry = emailToSubscriber.get(email)
          if (!entry) return null

          const { emailData, rendered } = getRenderedEmail(entry)
          // Store fully rendered content in the queue so it's ready to send
          const queueData: Record<string, any> = { ...emailData }
          if (rendered) {
            queueData._template_subject = rendered.subject
            queueData._template_html_content = rendered.htmlContent
            queueData._template_from = rendered.from
            queueData._template_processed = true
          }

          return {
            to_email: email,
            channel: "email",
            template: BLOG_TEMPLATE_KEY,
            data: queueData,
          }
        }).filter(Boolean) as any[]

        try {
          queuedCount = await providerManager.queueOverflowEmails(queueEntries)
          console.log(`Queued ${queuedCount} emails for tomorrow`)
        } catch (err) {
          console.error("Failed to queue overflow emails:", err.message)
        }
      }

      // Record usage per provider
      const usageByProvider = new Map<string, number>()
      for (const result of allResults.filter((r) => r.success)) {
        const provider = emailToProvider.get(result.email) || "resend"
        usageByProvider.set(provider, (usageByProvider.get(provider) || 0) + 1)
      }
      for (const [provider, count] of usageByProvider) {
        try {
          await providerManager.recordUsage(provider, count)
        } catch (err) {
          console.warn(`Failed to record usage for ${provider}:`, err.message)
        }
      }
    } else {
      // Fallback: single provider (Resend via "email" channel)
      for (const { subscriber, blogData, emailConfig } of allSubscribers) {
        const entry = emailToSubscriber.get(subscriber.email)
        if (!entry) continue

        try {
          const { emailData, rendered } = getRenderedEmail(entry)

          const notificationData: Record<string, any> = { ...emailData }
          if (rendered) {
            notificationData._template_subject = rendered.subject
            notificationData._template_html_content = rendered.htmlContent
            notificationData._template_from = rendered.from
            notificationData._template_processed = true
          }

          await notificationModuleService.createNotifications({
            to: subscriber.email,
            channel: "email",
            template: BLOG_TEMPLATE_KEY,
            data: notificationData,
          })

          allResults.push({ success: true, subscriber_id: subscriber.id, email: subscriber.email })
        } catch (error) {
          allResults.push({
            success: false, subscriber_id: subscriber.id, email: subscriber.email,
            error: error.message || "Unknown error",
          })
        }

        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }

    // Retry failed sends that are not validation errors (queue for next day)
    const PERMANENT_ERROR_PATTERNS = [
      "invalid `to` field", "validation_error", "invalid email", "email address",
    ]

    if (providerManager) {
      const retryable = allResults.filter((r) => {
        if (r.success) return false
        const errLower = (r.error || "").toLowerCase()
        return !PERMANENT_ERROR_PATTERNS.some((pat) => errLower.includes(pat))
      })

      if (retryable.length > 0) {
        console.log(`Queuing ${retryable.length} failed emails for retry`)
        const retryEntries = retryable
          .map((r) => {
            const entry = emailToSubscriber.get(r.email)
            if (!entry) return null

            const { emailData, rendered } = getRenderedEmail(entry)
            const queueData: Record<string, any> = { ...emailData }
            if (rendered) {
              queueData._template_subject = rendered.subject
              queueData._template_html_content = rendered.htmlContent
              queueData._template_from = rendered.from
              queueData._template_processed = true
            }

            return { to_email: r.email, channel: "email", template: BLOG_TEMPLATE_KEY, data: queueData }
          })
          .filter(Boolean) as any[]

        try {
          const retriedCount = await providerManager.queueOverflowEmails(retryEntries)
          queuedCount += retriedCount
        } catch (err) {
          console.error("Failed to queue retry emails:", err.message)
        }
      }
    }

    // Calculate statistics
    const sentList = allResults
      .filter((r) => r.success)
      .map((r) => ({ subscriber_id: r.subscriber_id, email: r.email }))

    const failedList = allResults
      .filter((r) => !r.success)
      .map((r) => ({ subscriber_id: r.subscriber_id, email: r.email, error: r.error || "Unknown error" }))

    const summary: SendingSummary = {
      totalSubscribers: allResults.length + queuedCount,
      sentCount: sentList.length,
      failedCount: failedList.length,
      queuedCount,
      sentList,
      failedList,
      sentAt: new Date().toISOString(),
    }

    console.log(`Blog email complete. Sent: ${summary.sentCount}, Failed: ${summary.failedCount}, Queued: ${queuedCount}`)

    return new StepResponse(summary)
  }
)
