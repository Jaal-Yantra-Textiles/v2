import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { SendingSummary } from "../types"
import { WEBSITE_MODULE } from "../../../../modules/website"

export const updatePageWithResultsStepId = "update-page-with-results"

/**
 * This step updates the blog page with information about the sending process.
 * It records when the blog was sent, how many subscribers received it,
 * and stores the list of subscribers in the page metadata.
 *
 * @example
 * updatePageWithResultsStep({ 
 *   page_id: "blog_123", 
 *   summary: { totalSubscribers: 100, sentCount: 95, failedCount: 5, ... } 
 * })
 */
export const updatePageWithResultsStep = createStep(
  updatePageWithResultsStepId,
  async (input: { page_id: string, summary: SendingSummary }, { container }) => {
    const { page_id, summary } = input
    
    console.log(`Updating page ${page_id} with sending results`)
    
    try {
      const pageService = container.resolve(WEBSITE_MODULE)
      
      // Update the page with subscription information
      await pageService.updatePages({
        selector: {
          id: input.page_id
        }, 
        data: {
            sent_to_subscribers: true,
            sent_to_subscribers_at: new Date(),
            subscriber_count: summary.sentCount,
            // Flatten metadata structure to avoid nested objects
            metadata: {
              // Store summary information as individual fields
              subscription_total_subscribers: summary.totalSubscribers,
              subscription_sent_count: summary.sentCount,
              subscription_failed_count: summary.failedCount,
              subscription_sent_at: new Date().toISOString(),
              
              // Store a list of subscribers who received the email (limit to IDs to save space)
              subscription_sent_to_ids: JSON.stringify(summary.sentList.map(s => s.subscriber_id)),
              
              // Store information about failed sends for troubleshooting
              // Convert to JSON string to avoid nested objects
              subscription_failed_sends: JSON.stringify(summary.failedList.map(f => ({
                id: f.subscriber_id,
                email: f.email,
                error: f.error
              })))
            }
          }
      })
      
      console.log(`Successfully updated page with sending results`)
      
      return new StepResponse({
        page_id,
        sent_to_subscribers: true,
        sent_to_subscribers_at: new Date(),
        subscriber_count: summary.sentCount
      })
    } catch (error) {
      console.error(`Error updating page with results: ${error.message}`)
      throw error
    }
  }
)
