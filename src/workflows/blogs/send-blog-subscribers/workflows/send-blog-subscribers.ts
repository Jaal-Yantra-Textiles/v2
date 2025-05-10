import {
  WorkflowData,
  WorkflowResponse,
  createWorkflow,
  transform,
} from "@medusajs/framework/workflows-sdk"
import {
  fetchBlogDataStep,
  getSubscribersStep,
  prepareSubscriberBatchesStep,
  processAllBatchesStep,
  processSubscriberBatchStep,
  updatePageWithResultsStep,
  waitConfirmationBlogSendStep,
  waitConfirmationBlogSendStepId
} from "../steps"
import { SendBlogSubscribersInput, SendingSummary, EmailSendingResult } from "../types"
import { notifyOnFailureStep, sendNotificationsStep } from "@medusajs/medusa/core-flows"

export const sendBlogSubscribersWorkflowId = "send-blog-subscribers"

/**
 * This workflow sends a blog post to all subscribers (persons with email addresses).
 * 
 * The workflow runs in the background and handles batching subscribers to avoid
 * overwhelming the email service. It updates the page with information about the
 * sending process when complete.
 * 
 * @example
 * To send a blog post to subscribers:
 * 
 * ```ts
 * const { result } = await sendBlogSubscribersWorkflow(container)
 * .run({
 *   input: {
 *     page_id: "blog_123",
 *     subject: "Check out our latest blog post!",
 *     customMessage: "We thought you might be interested in our latest article."
 *   }
 * })
 * ```
 * 
 * @summary
 * 
 * Send a blog post to all subscribers (persons with email addresses).
 */
export const sendBlogSubscribersWorkflow = createWorkflow(
  sendBlogSubscribersWorkflowId,
  (
    input: WorkflowData<SendBlogSubscribersInput>
  ): WorkflowResponse<{
    page_id: string
    totalSubscribers: number
    sentCount: number
    failedCount: number
  }> => {
    // Step 1: Fetch blog data
    const blogData = fetchBlogDataStep(input)
    
    // Step 2: Get subscribers
    const subscribers = getSubscribersStep()
    
    // Step 3: Prepare subscriber batches
    const batches = prepareSubscriberBatchesStep({
      subscribers,
      blogData,
      emailConfig: {
        subject: input.subject,
        customMessage: input.customMessage
      }
    })
    
    // Step 4: Wait for confirmation before proceeding
    // This makes the workflow long-running and requires explicit confirmation
    const confirmed = waitConfirmationBlogSendStep()
    
    // Create failure notification configuration
    const failureNotification = transform({ input, blogData }, (data) => {
      return [
        {
          to: "",
          channel: "feed",
          template: "admin-ui",
          data: {
            title: "Blog Subscription",
            description: `Failed to send blog "${data.blogData.title}" to subscribers.`,
          },
        },
      ]
    })
    
    // Set up failure notification
    notifyOnFailureStep(failureNotification)
    
    // Step 4: Process each batch of subscribers
    // This will run for each batch and collect all results
    const batchResults = processAllBatchesStep(batches)
    
    // Step 5: Use the summary from the batch processing step
    // The processAllBatchesStep now returns a single SendingSummary object
    const sendingSummary = transform({ batchResults }, (data) => {
      // If we have results, use them directly
      return data.batchResults || {
        totalSubscribers: 0,
        sentCount: 0,
        failedCount: 0,
        sentList: [],
        failedList: [],
        sentAt: new Date().toISOString()
      }
    })
    
    // Step 6: Update page with results
    const pageUpdateResult = updatePageWithResultsStep({
      page_id: input.page_id,
      summary: sendingSummary
    })
    
    // Step 7: Send success notification
    const successNotification = transform({ input, blogData, sendingSummary }, (data) => {
      return [
        {
          to: "",
          channel: "feed",
          template: "admin-ui",
          data: {
            title: "Blog Subscription",
            description: `Successfully sent blog "${data.blogData.title}" to ${data.sendingSummary.sentCount} subscribers.`,
          },
        },
      ]
    })
    
    sendNotificationsStep(successNotification)
    
    // Return the final result
    const result = transform({ input, sendingSummary }, (data) => {
      return {
        page_id: data.input.page_id,
        totalSubscribers: data.sendingSummary.totalSubscribers,
        sentCount: data.sendingSummary.sentCount,
        failedCount: data.sendingSummary.failedCount
      }
    })
    
    return new WorkflowResponse(result)
  }
)
