/**
 * @file Admin API route for retrying failed publishing campaign items
 * @description Provides an endpoint to retry failed items in a publishing campaign
 * @module API/Admin/PublishingCampaigns
 */

/**
 * @typedef {Object} RetryItemRequest
 * @property {number} item_index.required - The index of the campaign item to retry
 */

/**
 * @typedef {Object} CampaignItem
 * @property {string} product_id - The ID of the product associated with this item
 * @property {string} status - The current status of the item (publishing, published, failed)
 * @property {string} [social_post_id] - The ID of the created social post
 * @property {Date} [published_at] - When the item was published
 * @property {string} [error_message] - Error message if publishing failed
 */

/**
 * @typedef {Object} PublishingCampaign
 * @property {string} id - The unique identifier for the campaign
 * @property {string} name - The name of the campaign
 * @property {string} platform_id - The ID of the social platform
 * @property {string} content_rule - The content rule for publishing
 * @property {CampaignItem[]} items - Array of campaign items
 */

/**
 * @typedef {Object} RetryItemResponse
 * @property {boolean} success - Whether the retry operation was successful
 * @property {PublishingCampaign} campaign - The updated campaign object
 * @property {CampaignItem} item - The updated campaign item
 */

/**
 * Retry a failed campaign item
 * @route POST /admin/publishing-campaigns/:id/retry-item
 * @group PublishingCampaign - Operations related to publishing campaigns
 * @param {string} id.path.required - The ID of the publishing campaign
 * @param {RetryItemRequest} request.body.required - The item index to retry
 * @returns {RetryItemResponse} 200 - Success response with updated campaign and item
 * @throws {MedusaError} 400 - Invalid item index or item not in failed state
 * @throws {MedusaError} 404 - Campaign not found
 * @throws {MedusaError} 500 - Internal server error during retry process
 *
 * @example request
 * POST /admin/publishing-campaigns/camp_123456789/retry-item
 * {
 *   "item_index": 2
 * }
 *
 * @example response 200
 * {
 *   "success": true,
 *   "campaign": {
 *     "id": "camp_123456789",
 *     "name": "Summer Collection 2023",
 *     "platform_id": "plat_987654321",
 *     "content_rule": "standard",
 *     "items": [
 *       {
 *         "product_id": "prod_111111111",
 *         "status": "published",
 *         "social_post_id": "post_111111111",
 *         "published_at": "2023-06-15T10:00:00Z"
 *       },
 *       {
 *         "product_id": "prod_222222222",
 *         "status": "published",
 *         "social_post_id": "post_222222222",
 *         "published_at": "2023-06-15T10:05:00Z"
 *       },
 *       {
 *         "product_id": "prod_333333333",
 *         "status": "published",
 *         "social_post_id": "post_333333333",
 *         "published_at": "2023-06-15T10:10:00Z"
 *       }
 *     ]
 *   },
 *   "item": {
 *     "product_id": "prod_333333333",
 *     "status": "published",
 *     "social_post_id": "post_333333333",
 *     "published_at": "2023-06-15T10:10:00Z"
 *   }
 * }
 *
 * @example response 400
 * {
 *   "error": "Invalid item index"
 * }
 *
 * @example response 404
 * {
 *   "error": "Campaign not found"
 * }
 *
 * @example response 500
 * {
 *   "success": false,
 *   "error": "Failed to process campaign item"
 * }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import SocialsService from "../../../../../modules/socials/service"
import { processCampaignItemWorkflow } from "../../../../../workflows/socials/scheduled-publishing"
import { CampaignItem } from "../../../../../modules/socials/types/publishing-automation"

/**
 * POST /admin/publishing-campaigns/:id/retry-item
 * Retry a failed campaign item
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const { item_index } = req.body as { item_index: number }
  
  const socialsService: SocialsService = req.scope.resolve(SOCIALS_MODULE)
  
  // Get campaign
  const [campaign] = await socialsService.listPublishingCampaigns({ id }) as any[]
  if (!campaign) {
    return res.status(404).json({ error: "Campaign not found" })
  }
  
  // Validate item index
  const items: CampaignItem[] = campaign.items || []
  if (item_index < 0 || item_index >= items.length) {
    return res.status(400).json({ error: "Invalid item index" })
  }
  
  const item = items[item_index]
  
  // Only allow retry for failed items
  if (item.status !== "failed") {
    return res.status(400).json({ 
      error: `Cannot retry item with status "${item.status}". Only failed items can be retried.` 
    })
  }
  
  // Get platform name
  const [platform] = await socialsService.listSocialPlatforms({ id: campaign.platform_id })
  const platformName = (platform as any)?.name || "Unknown"
  
  // Update item status to publishing
  items[item_index].status = "publishing"
  items[item_index].error_message = undefined
  
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
        item_index: item_index,
        content_rule: campaign.content_rule,
      },
    })
    
    // Update item with result
    items[item_index].status = result.success ? "published" : "failed"
    items[item_index].social_post_id = result.social_post_id
    items[item_index].published_at = result.success ? new Date() : undefined
    if (!result.success) {
      items[item_index].error_message = result.error || "Publishing failed"
    }
    
    await socialsService.updatePublishingCampaigns({
      id: campaign.id,
      items: items as any,
    } as any)
    
    // Refetch campaign for response
    const [updatedCampaign] = await socialsService.listPublishingCampaigns({ id }) as any[]
    
    return res.json({ 
      success: result.success,
      campaign: updatedCampaign,
      item: items[item_index],
    })
    
  } catch (error: any) {
    // Mark item as failed again
    items[item_index].status = "failed"
    items[item_index].error_message = error.message
    
    await socialsService.updatePublishingCampaigns({
      id: campaign.id,
      items: items as any,
    } as any)
    
    return res.status(500).json({ 
      success: false,
      error: error.message,
    })
  }
}
