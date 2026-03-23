import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { SendingSummary } from "../types"
import { WEBSITE_MODULE } from "../../../../modules/website"
import WebsiteService from "../../../../modules/website/service"

export const updatePageWithResultsStepId = "update-page-with-results"

export const updatePageWithResultsStep = createStep(
  updatePageWithResultsStepId,
  async (input: { page_id: string; summary: SendingSummary }, { container }) => {
    const { page_id, summary } = input

    console.log(`[updatePageWithResults] Updating page ${page_id} with sending results`)

    const pageService: WebsiteService = container.resolve(WEBSITE_MODULE)

    // 1) Write individual send logs to the dedicated table
    const logEntries: any[] = []

    for (const sent of summary.sentList) {
      logEntries.push({
        page_id,
        subscriber_id: sent.subscriber_id,
        subscriber_email: sent.email,
        provider: (sent as any).provider || null,
        status: "sent",
        sent_at: new Date(),
      })
    }

    for (const failed of summary.failedList) {
      logEntries.push({
        page_id,
        subscriber_id: failed.subscriber_id,
        subscriber_email: failed.email,
        provider: (failed as any).provider || null,
        status: "failed",
        error: failed.error,
        sent_at: new Date(),
      })
    }

    if (summary.queuedCount && summary.queuedCount > 0) {
      // Queued entries don't have individual subscriber info in the summary,
      // so we record the count in page metadata only.
    }

    if (logEntries.length > 0) {
      try {
        // Batch-create in chunks of 100 to avoid oversized queries
        const CHUNK = 100
        for (let i = 0; i < logEntries.length; i += CHUNK) {
          const chunk = logEntries.slice(i, i + CHUNK)
          await pageService.createSubscriptionSendLogs(chunk)
        }
        console.log(
          `[updatePageWithResults] Created ${logEntries.length} subscription send log entries`
        )
      } catch (err) {
        console.error(
          `[updatePageWithResults] Failed to create send logs: ${(err as Error).message}`
        )
        // Non-fatal — continue to update the page summary fields
      }
    }

    // 2) Update the page with lightweight summary (no large arrays in metadata)
    await pageService.updatePages({
      selector: { id: page_id },
      data: {
        sent_to_subscribers: true,
        sent_to_subscribers_at: new Date(),
        subscriber_count: summary.sentCount,
        metadata: {
          subscription_total_subscribers: summary.totalSubscribers,
          subscription_sent_count: summary.sentCount,
          subscription_failed_count: summary.failedCount,
          subscription_queued_count: summary.queuedCount || 0,
          subscription_sent_at: new Date().toISOString(),
        },
      },
    })

    console.log(`[updatePageWithResults] Page updated successfully`)

    return new StepResponse({
      page_id,
      sent_to_subscribers: true,
      sent_to_subscribers_at: new Date(),
      subscriber_count: summary.sentCount,
      log_entries_created: logEntries.length,
    })
  }
)
