import {
  createWorkflow,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import {
  initializeCampaignStep,
  awaitNextPublishStep,
  loadProductWithDesignStep,
  generateContentStep,
  publishItemStep,
} from "./steps"
import { ScheduledPublishingInput, SCHEDULED_PUBLISHING_WORKFLOW_ID } from "./types"

/**
 * Scheduled Product Publishing Workflow
 * 
 * A long-running workflow that publishes products to social media on a schedule.
 * 
 * Flow:
 * 1. Initialize campaign with all products and schedule
 * 2. For each product:
 *    a. Wait for scheduled time (async step - signaled by scheduler)
 *    b. Load product with design
 *    c. Generate content using content rule
 *    d. Create and publish social post
 * 3. Complete campaign
 * 
 * The workflow can be:
 * - Paused: Stop processing, can be resumed
 * - Cancelled: Stop and mark as cancelled
 * - Skipped: Skip current item and move to next
 * 
 * Note: Due to MedusaJS workflow limitations, this workflow processes
 * the first item and then needs to be signaled to continue with subsequent items.
 * A scheduler job handles the timing and signaling.
 */
export const scheduledPublishingWorkflow = createWorkflow(
  {
    name: SCHEDULED_PUBLISHING_WORKFLOW_ID,
    store: true, // Persist workflow state
  },
  (input: ScheduledPublishingInput) => {
    // Step 1: Initialize campaign
    const campaignState = initializeCampaignStep(input)
    
    // Extract first item info for the await step
    const firstItemInfo = transform(campaignState, (state) => ({
      item_index: 0,
      scheduled_at: state.items[0]?.scheduled_at?.toISOString() || new Date().toISOString(),
    }))
    
    // Step 2: Wait for first publish time
    // This is an async step that will be signaled by the scheduler
    awaitNextPublishStep(firstItemInfo)
    
    // Step 3: Load first product with design
    const firstProductId = transform(campaignState, (state) => ({
      product_id: state.items[0]?.product_id || "",
    }))
    const productData = loadProductWithDesignStep(firstProductId)
    
    // Step 4: Generate content
    const contentInput = transform(
      { productData, campaignState },
      (data) => ({
        product: data.productData.product,
        design: data.productData.design,
        content_rule: data.campaignState.content_rule,
        platform_name: data.campaignState.platform_name,
      })
    )
    const generatedContent = generateContentStep(contentInput)
    
    // Step 5: Publish the item
    const publishInput = transform(
      { generatedContent, campaignState, input },
      (data) => ({
        content: data.generatedContent.content,
        platform_id: data.campaignState.platform_id,
        campaign_name: data.campaignState.name,
        item_index: 0,
        transaction_id: "", // Will be set by context
      })
    )
    const publishResult = publishItemStep(publishInput)
    
    // Return campaign state and first publish result
    const result = transform(
      { campaignState, publishResult },
      (data) => ({
        campaign: {
          name: data.campaignState.name,
          platform_name: data.campaignState.platform_name,
          status: data.campaignState.status,
          total_items: data.campaignState.items.length,
          current_index: 0,
          items: data.campaignState.items,
        },
        first_publish: data.publishResult,
      })
    )
    
    return new WorkflowResponse(result)
  }
)

export default scheduledPublishingWorkflow
