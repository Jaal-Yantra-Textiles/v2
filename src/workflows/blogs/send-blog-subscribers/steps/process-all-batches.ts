import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { SubscriberBatch, EmailSendingResult, SendingSummary } from "../types"
import { Modules } from "@medusajs/framework/utils"
import { convertTipTapToHtml } from "../utils/tiptap-to-html"
import { sendMailjetBulk, BulkEmailEntry } from "../utils/mailjet-bulk-send"
import { INotificationModuleService } from "@medusajs/types"
import { EMAIL_PROVIDER_MANAGER_MODULE } from "../../../../modules/email-provider-manager"
import EmailProviderManagerService from "../../../../modules/email-provider-manager/service"

export const processAllBatchesStepId = "process-all-batches"

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
        const parsed = JSON.parse(content)
        return convertTipTapToHtml(parsed)
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

/**
 * This step processes all subscriber batches with load distribution across
 * multiple email providers (Resend + Mailjet).
 *
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
      console.warn(
        "Email provider manager not available, falling back to single provider (email channel):",
        err.message
      )
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
    console.log(`Processing ${totalEmails} total subscriber emails with load distribution`)

    // Pre-compute HTML content once (same blog for all subscribers)
    let sharedHtmlContent: string | null = null
    if (allSubscribers.length > 0) {
      try {
        sharedHtmlContent = convertContentToHtml(allSubscribers[0].blogData.content)
      } catch {
        sharedHtmlContent = String(allSubscribers[0].blogData.content || "No content available")
      }
    }

    let queuedCount = 0

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
        overflow.length > 0 ? `| Overflow: ${overflow.length} emails queued for tomorrow` : ""
      )

      // Build a lookup: email -> subscriber data
      const emailToSubscriber = new Map<string, typeof allSubscribers[0]>()
      for (const entry of allSubscribers) {
        emailToSubscriber.set(entry.subscriber.email, entry)
      }

      // Build a lookup: email -> provider
      const emailToProvider = new Map<string, string>()
      for (const allocation of allocations) {
        for (const email of allocation.emails) {
          emailToProvider.set(email, allocation.provider)
        }
      }

      // --- Mailjet bulk sending ---
      const mailjetAllocation = allocations.find((a) => a.provider === "mailjet")
      if (mailjetAllocation && mailjetAllocation.emails.length > 0) {
        console.log(`Sending ${mailjetAllocation.emails.length} emails via Mailjet bulk API`)

        const bulkEntries: BulkEmailEntry[] = []
        for (const email of mailjetAllocation.emails) {
          const entry = emailToSubscriber.get(email)
          if (!entry) continue

          const htmlContent = sharedHtmlContent || ""
          const emailData = buildEmailData(entry.subscriber, entry.blogData, htmlContent, entry.emailConfig)

          bulkEntries.push({
            to: email,
            subject: entry.emailConfig.subject,
            // Use the processed template content if available, otherwise fall back
            htmlContent: emailData._template_html_content || htmlContent,
          })
        }

        const bulkResult = await sendMailjetBulk(bulkEntries)

        for (const email of bulkResult.successful) {
          const entry = emailToSubscriber.get(email)
          allResults.push({
            success: true,
            subscriber_id: entry?.subscriber.id || "",
            email,
          })
        }

        for (const fail of bulkResult.failed) {
          const entry = emailToSubscriber.get(fail.email)
          allResults.push({
            success: false,
            subscriber_id: entry?.subscriber.id || "",
            email: fail.email,
            error: fail.error,
          })
        }
      }

      // --- Resend one-at-a-time sending ---
      const resendAllocation = allocations.find((a) => a.provider === "resend")
      if (resendAllocation && resendAllocation.emails.length > 0) {
        console.log(`Sending ${resendAllocation.emails.length} emails via Resend`)

        for (const email of resendAllocation.emails) {
          const entry = emailToSubscriber.get(email)
          if (!entry) continue

          try {
            const htmlContent = sharedHtmlContent || ""
            const emailData = buildEmailData(entry.subscriber, entry.blogData, htmlContent, entry.emailConfig)

            await notificationModuleService.createNotifications({
              to: email,
              channel: "email",
              template:
                process.env.SENDGRID_BLOG_SUBSCRIPTION_TEMPLATE ||
                "d-blog-subscription-template",
              data: emailData,
            })

            allResults.push({
              success: true,
              subscriber_id: entry.subscriber.id,
              email,
            })
          } catch (error) {
            allResults.push({
              success: false,
              subscriber_id: entry.subscriber.id,
              email,
              error: error.message || "Unknown error",
            })
          }

          // Small delay between individual sends
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      }

      // --- Queue overflow emails for the next day ---
      if (overflow.length > 0) {
        console.log(`Queuing ${overflow.length} overflow emails for tomorrow`)

        const queueEntries = overflow.map((email) => {
          const entry = emailToSubscriber.get(email)
          if (!entry) return null

          const htmlContent = sharedHtmlContent || ""
          const emailData = buildEmailData(entry.subscriber, entry.blogData, htmlContent, entry.emailConfig)

          return {
            to_email: email,
            channel: "email", // default channel, job will re-distribute
            template:
              process.env.SENDGRID_BLOG_SUBSCRIPTION_TEMPLATE ||
              "d-blog-subscription-template",
            data: emailData,
          }
        }).filter(Boolean) as any[]

        try {
          queuedCount = await providerManager.queueOverflowEmails(queueEntries)
          console.log(`Successfully queued ${queuedCount} emails for tomorrow`)
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
          console.log(`Recorded ${count} emails sent via ${provider}`)
        } catch (err) {
          console.warn(`Failed to record usage for ${provider}:`, err.message)
        }
      }
    } else {
      // Fallback: single provider (Resend via "email" channel)
      for (const { subscriber, blogData, emailConfig } of allSubscribers) {
        try {
          const htmlContent = sharedHtmlContent ||
            (() => { try { return convertContentToHtml(blogData.content) } catch { return String(blogData.content || "No content available") } })()

          const emailData = buildEmailData(subscriber, blogData, htmlContent, emailConfig)

          await notificationModuleService.createNotifications({
            to: subscriber.email,
            channel: "email",
            template:
              process.env.SENDGRID_BLOG_SUBSCRIPTION_TEMPLATE ||
              "d-blog-subscription-template",
            data: emailData,
          })

          allResults.push({
            success: true,
            subscriber_id: subscriber.id,
            email: subscriber.email,
          })
        } catch (error) {
          allResults.push({
            success: false,
            subscriber_id: subscriber.id,
            email: subscriber.email,
            error: error.message || "Unknown error",
          })
        }

        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }

    // Calculate statistics
    const sentList = allResults
      .filter((result) => result.success)
      .map((result) => ({
        subscriber_id: result.subscriber_id,
        email: result.email,
      }))

    const failedList = allResults
      .filter((result) => !result.success)
      .map((result) => ({
        subscriber_id: result.subscriber_id,
        email: result.email,
        error: result.error || "Unknown error",
      }))

    const summary: SendingSummary = {
      totalSubscribers: allResults.length + queuedCount,
      sentCount: sentList.length,
      failedCount: failedList.length,
      queuedCount,
      sentList,
      failedList,
      sentAt: new Date().toISOString(),
    }

    console.log(
      `Blog email sending complete. Sent: ${summary.sentCount}, Failed: ${summary.failedCount}, Queued: ${queuedCount}`
    )

    return new StepResponse(summary)
  }
)
