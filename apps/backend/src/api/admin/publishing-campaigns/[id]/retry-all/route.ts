/**
 * @file Admin API route for retrying failed items in a publishing campaign
 * @description Provides an endpoint to retry all failed items in a publishing campaign in the JYT Commerce platform
 * @module API/Admin/PublishingCampaigns
 */

/**
 * @typedef {Object} RetryAllResponse
 * @property {boolean} success - Whether the operation was successful
 * @property {string} message - Human-readable message about the operation result
 * @property {number} retried - Total number of items that were retried
 * @property {number} succeeded - Number of items that were successfully published
 * @property {number} failed - Number of items that failed to publish
 * @property {Object} campaign - The updated campaign object
 * @property {string} campaign.id - The campaign ID
 * @property {string} campaign.name - The campaign name
 * @property {string} campaign.platform_id - The social platform ID
 * @property {string} campaign.status - The campaign status
 * @property {Object[]} campaign.items - Array of campaign items
 * @property {string} campaign.items[].product_id - The product ID
 * @property {string} campaign.items[].status - The item status (publishing, published, failed)
 * @property {string} [campaign.items[].social_post_id] - The social post ID if published
 * @property {Date} [campaign.items[].published_at] - When the item was published
 * @property {string} [campaign.items[].error_message] - Error message if failed
 */

/**
 * Retry all failed items in a publishing campaign
 * @route POST /admin/publishing-campaigns/:id/retry-all
 * @group PublishingCampaign - Operations related to publishing campaigns
 * @param {string} id.path.required - The ID of the publishing campaign
 * @returns {RetryAllResponse} 200 - Result of the retry operation
 * @throws {MedusaError} 404 - Campaign not found
 * @throws {MedusaError} 500 - Internal server error during processing
 *
 * @example request
 * POST /admin/publishing-campaigns/camp_123456789/retry-all
 *
 * @example response 200
 * {
 *   "success": true,
 *   "message": "Retried 3 items: 2 succeeded, 1 failed",
 *   "retried": 3,
 *   "succeeded": 2,
 *   "failed": 1,
 *   "campaign": {
 *     "id": "camp_123456789",
 *     "name": "Summer Collection Launch",
 *     "platform_id": "plat_987654321",
 *     "status": "active",
 *     "items": [
 *       {
 *         "product_id": "prod_111111111",
 *         "status": "published",
 *         "social_post_id": "post_111111111",
 *         "published_at": "2023-06-15T10:30:00Z"
 *       },
 *       {
 *         "product_id": "prod_222222222",
 *         "status": "published",
 *         "social_post_id": "post_222222222",
 *         "published_at": "2023-06-15T10:31:00Z"
 *       },
 *       {
 *         "product_id": "prod_333333333",
 *         "status": "failed",
 *         "error_message": "Invalid product data"
 *       }
 *     ]
 *   }
 * }
 *
 * @example response 404
 * {
 *   "error": "Campaign not found"
 * }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import SocialsService from "../../../../../modules/socials/service"
import { processCampaignItemWorkflow } from "../../../../../workflows/socials/scheduled-publishing"
import { CampaignItem } from "../../../../../modules/socials/types/publishing-automation"

/**
 * POST /admin/publishing-campaigns/:id/retry-all
 * Retry all failed items in a campaign
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  
  const socialsService: SocialsService = req.scope.resolve(SOCIALS_MODULE)
  
  // Get campaign
  const [campaign] = await socialsService.listPublishingCampaigns({ id }) as any[]
  if (!campaign) {
    return res.status(404).json({ error: "Campaign not found" })
  }
  
  const items: CampaignItem[] = campaign.items || []
  const failedIndices = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.status === "failed")
    .map(({ index }) => index)
  
  if (failedIndices.length === 0) {
    return res.json({ 
      success: true, 
      message: "No failed items to retry",
      retried: 0,
      succeeded: 0,
      failed: 0,
    })
  }
  
  // Get platform name
  const [platform] = await socialsService.listSocialPlatforms({ id: campaign.platform_id })
  const platformName = (platform as any)?.name || "Unknown"
  
  let succeeded = 0
  let failed = 0
  
  // Process each failed item
  for (const itemIndex of failedIndices) {
    const item = items[itemIndex]
    
    // Update item status to publishing
    items[itemIndex].status = "publishing"
    items[itemIndex].error_message = undefined
    
    await socialsService.updatePublishingCampaigns({
      id: campaign.id,
      items: items as any,
    } as any)
    
    try {
      // Run the publish workflow
      const { result } = await processCampaignItemWorkflow(req.scope).run({
        input: {
          product_id: item.product_id,
          platform_id: campaign.platform_id,
          platform_name: platformName,
          campaign_name: campaign.name,
          campaign_id: campaign.id,
          item_index: itemIndex,
          content_rule: campaign.content_rule,
        },
      })
      
      // Update item with result
      items[itemIndex].status = result.success ? "published" : "failed"
      items[itemIndex].social_post_id = result.social_post_id
      items[itemIndex].published_at = result.success ? new Date() : undefined
      if (!result.success) {
        items[itemIndex].error_message = result.error || "Publishing failed"
        failed++
      } else {
        succeeded++
      }
      
    } catch (error: any) {
      // Mark item as failed again
      items[itemIndex].status = "failed"
      items[itemIndex].error_message = error.message
      failed++
    }
    
    // Update campaign after each item
    await socialsService.updatePublishingCampaigns({
      id: campaign.id,
      items: items as any,
    } as any)
  }
  
  // Refetch campaign for response
  const [updatedCampaign] = await socialsService.listPublishingCampaigns({ id }) as any[]
  
  return res.json({ 
    success: true,
    message: `Retried ${failedIndices.length} items: ${succeeded} succeeded, ${failed} failed`,
    retried: failedIndices.length,
    succeeded,
    failed,
    campaign: updatedCampaign,
  })
}
