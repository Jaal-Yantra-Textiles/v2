import {
  createWorkflow,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { notifyOnFailureStep } from "@medusajs/medusa/core-flows"
import {
  loadProductWithDesignStep,
  generateContentStep,
  publishItemStep,
} from "./steps"
import { ContentRule } from "../../../modules/socials/types/publishing-automation"

/**
 * Process Campaign Item Workflow
 * 
 * Processes a single item from a publishing campaign.
 * This is called by the scheduler for each item when its publish time arrives.
 * 
 * This separation allows:
 * - Independent processing of each item
 * - Easy retry of failed items
 * - No complex async waiting within the workflow
 */

export interface ProcessCampaignItemInput {
  /** Product ID to publish */
  product_id: string
  
  /** Platform ID */
  platform_id: string
  
  /** Platform name */
  platform_name: string
  
  /** Campaign name */
  campaign_name: string
  
  /** Campaign ID (parent workflow transaction ID) */
  campaign_id: string
  
  /** Item index in campaign */
  item_index: number
  
  /** Content rule to apply */
  content_rule: ContentRule
}

export const processCampaignItemWorkflow = createWorkflow(
  "process-campaign-item",
  (input: ProcessCampaignItemInput) => {
    // Configure failure notification to admin feed
    const failureNotification = transform({ input }, (data) => {
      return [
        {
          to: "",
          channel: "feed",
          template: "admin-ui",
          data: {
            title: "Campaign Item Failed",
            description: `Failed to publish item ${data.input.item_index + 1} from campaign "${data.input.campaign_name}" (Product: ${data.input.product_id})`,
          },
        },
      ]
    })
    notifyOnFailureStep(failureNotification)
    
    // Step 1: Load product with design
    const productData = loadProductWithDesignStep({ product_id: input.product_id })
    
    // Step 2: Generate content
    const contentInput = transform(
      { productData, input },
      (data) => ({
        product: data.productData.product,
        design: data.productData.design,
        content_rule: data.input.content_rule,
        platform_name: data.input.platform_name,
      })
    )
    const generatedContent = generateContentStep(contentInput)
    
    // Step 3: Publish the item
    const publishInput = transform(
      { generatedContent, input },
      (data) => ({
        content: data.generatedContent.content,
        platform_id: data.input.platform_id,
        campaign_name: data.input.campaign_name,
        item_index: data.input.item_index,
        transaction_id: data.input.campaign_id,
      })
    )
    const publishResult = publishItemStep(publishInput)
    
    // Return result
    const result = transform(
      { publishResult, input, generatedContent },
      (data) => ({
        success: data.publishResult.success,
        product_id: data.input.product_id,
        product_title: data.generatedContent.content.product_title,
        social_post_id: data.publishResult.social_post_id,
        post_url: data.publishResult.post_url,
        error: data.publishResult.error,
        item_index: data.input.item_index,
      })
    )
    
    return new WorkflowResponse(result)
  }
)

export default processCampaignItemWorkflow
