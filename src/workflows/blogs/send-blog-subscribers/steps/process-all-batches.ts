import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { SubscriberBatch, EmailSendingResult, SendingSummary } from "../types"
import { Modules } from "@medusajs/framework/utils"
import { convertTipTapToHtml } from "../utils/tiptap-to-html"
import { INotificationModuleService } from "@medusajs/types"
import { EMAIL_PROVIDER_MANAGER_MODULE } from "../../../../modules/email-provider-manager"
import EmailProviderManagerService from "../../../../modules/email-provider-manager/service"

export const processAllBatchesStepId = "process-all-batches"

// Maps provider IDs to notification channels
const PROVIDER_CHANNEL_MAP: Record<string, string> = {
  resend: "email",
  mailjet: "email_bulk",
}

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
 * multiple email providers (Resend: 100/day, Mailjet: 200/day).
 *
 * It uses the email-provider-manager module to track daily usage and
 * distribute emails across providers based on remaining capacity.
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

    if (providerManager) {
      // Get remaining capacity across providers
      const capacities = await providerManager.getRemainingCapacity()
      console.log(
        "Provider capacity:",
        capacities.map((c) => `${c.provider}: ${c.remaining}/${c.limit} remaining`).join(", ")
      )

      // Distribute email addresses across providers
      const emailAddresses = allSubscribers.map((s) => s.subscriber.email)
      const allocations = await providerManager.distributeEmails(emailAddresses)

      console.log(
        "Allocation plan:",
        allocations.map((a) => `${a.provider}: ${a.emails.length} emails`).join(", ")
      )

      // Build a lookup: email -> provider
      const emailToProvider = new Map<string, string>()
      for (const allocation of allocations) {
        for (const email of allocation.emails) {
          emailToProvider.set(email, allocation.provider)
        }
      }

      // Process each subscriber, sending through the assigned provider
      for (const { subscriber, blogData, emailConfig } of allSubscribers) {
        const provider = emailToProvider.get(subscriber.email) || "resend"
        const channel = PROVIDER_CHANNEL_MAP[provider] || "email"

        try {
          let htmlContent: string
          try {
            htmlContent = convertContentToHtml(blogData.content)
          } catch {
            htmlContent = String(blogData.content || "No content available")
          }

          const emailData = buildEmailData(subscriber, blogData, htmlContent, emailConfig)

          await notificationModuleService.createNotifications({
            to: subscriber.email,
            channel,
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

        // Small delay to avoid overwhelming providers
        await new Promise((resolve) => setTimeout(resolve, 100))
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
          let htmlContent: string
          try {
            htmlContent = convertContentToHtml(blogData.content)
          } catch {
            htmlContent = String(blogData.content || "No content available")
          }

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
      totalSubscribers: allResults.length,
      sentCount: sentList.length,
      failedCount: failedList.length,
      sentList,
      failedList,
      sentAt: new Date().toISOString(),
    }

    console.log(
      `Blog email sending complete. Sent: ${summary.sentCount}, Failed: ${summary.failedCount}`
    )

    return new StepResponse(summary)
  }
)
