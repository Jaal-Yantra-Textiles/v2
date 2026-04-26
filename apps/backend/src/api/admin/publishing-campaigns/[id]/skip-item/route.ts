/**
 * @file Admin API route for skipping items in publishing campaigns
 * @description Provides endpoints for managing publishing campaign items in the JYT Commerce platform
 * @module API/Admin/PublishingCampaigns
 */

/**
 * @typedef {Object} SkipItemRequest
 * @property {number} item_index.required - The index of the item to skip in the campaign's items array
 */

/**
 * @typedef {Object} PublishingCampaignItem
 * @property {string} id - The unique identifier of the item
 * @property {string} status - The status of the item (pending, published, skipped, failed)
 * @property {Object} content - The content of the item to be published
 * @property {Date} scheduled_at - When the item is scheduled to be published
 */

/**
 * @typedef {Object} PublishingCampaign
 * @property {string} id - The unique identifier of the campaign
 * @property {string} name - The name of the campaign
 * @property {string} status - The status of the campaign (draft, active, completed, cancelled)
 * @property {PublishingCampaignItem[]} items - Array of items in the campaign
 * @property {Date} created_at - When the campaign was created
 * @property {Date} updated_at - When the campaign was last updated
 */

/**
 * @typedef {Object} SkipItemResponse
 * @property {PublishingCampaign} campaign - The updated publishing campaign
 * @property {string} message - Confirmation message about the skipped item
 */

/**
 * Skip a specific item in a publishing campaign
 * @route POST /admin/publishing-campaigns/:id/skip-item
 * @group PublishingCampaign - Operations related to publishing campaigns
 * @param {string} id.path.required - The ID of the publishing campaign
 * @param {SkipItemRequest} request.body.required - Item index to skip
 * @returns {SkipItemResponse} 200 - Updated campaign with skipped item
 * @throws {MedusaError} 400 - Invalid item_index or item not in pending status
 * @throws {MedusaError} 404 - Campaign not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * POST /admin/publishing-campaigns/camp_123456789/skip-item
 * {
 *   "item_index": 2
 * }
 *
 * @example response 200
 * {
 *   "campaign": {
 *     "id": "camp_123456789",
 *     "name": "Summer Sale Campaign",
 *     "status": "active",
 *     "items": [
 *       {
 *         "id": "item_001",
 *         "status": "published",
 *         "content": {
 *           "title": "Summer Sale Announcement",
 *           "body": "Big discounts coming soon!"
 *         },
 *         "scheduled_at": "2023-06-01T09:00:00Z"
 *       },
 *       {
 *         "id": "item_002",
 *         "status": "pending",
 *         "content": {
 *           "title": "Flash Sale Reminder",
 *           "body": "Don't miss our 24-hour flash sale!"
 *         },
 *         "scheduled_at": "2023-06-02T10:00:00Z"
 *       },
 *       {
 *         "id": "item_003",
 *         "status": "skipped",
 *         "content": {
 *           "title": "Extended Sale Notice",
 *           "body": "Sale extended by popular demand!"
 *         },
 *         "scheduled_at": "2023-06-03T11:00:00Z"
 *       }
 *     ],
 *     "created_at": "2023-05-15T08:00:00Z",
 *     "updated_at": "2023-05-20T14:30:00Z"
 *   },
 *   "message": "Item 2 skipped."
 * }
 *
 * @example response 400
 * {
 *   "error": "Item index out of range"
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

/**
 * POST /admin/publishing-campaigns/:id/skip-item
 * Skip a specific item in the campaign
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const socialsService: SocialsService = req.scope.resolve(SOCIALS_MODULE)
  const { id } = req.params
  const { item_index } = req.body as { item_index: number }
  
  if (item_index === undefined || item_index < 0) {
    return res.status(400).json({ error: "Valid item_index is required" })
  }
  
  const [campaign] = await socialsService.listPublishingCampaigns({ id })
  if (!campaign) {
    return res.status(404).json({ error: "Campaign not found" })
  }
  
  const campaignData = campaign as any
  const items = campaignData.items || []
  
  if (item_index >= items.length) {
    return res.status(400).json({ error: "Item index out of range" })
  }
  
  const item = items[item_index]
  
  // Only allow skipping pending items
  if (item.status !== "pending") {
    return res.status(400).json({ 
      error: `Cannot skip item with status: ${item.status}` 
    })
  }
  
  // Update item status
  items[item_index].status = "skipped"
  
  const updated = await socialsService.updatePublishingCampaigns({
    id,
    items: items as any,
  } as any)
  
  return res.json({ 
    campaign: updated,
    message: `Item ${item_index} skipped.`,
  })
}
