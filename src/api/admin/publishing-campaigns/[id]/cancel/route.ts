/**
 * @file Admin API route for cancelling publishing campaigns
 * @description Provides endpoints for cancelling publishing campaigns in the JYT Commerce platform
 * @module API/Admin/PublishingCampaigns
 */

/**
 * @typedef {Object} PublishingCampaignItem
 * @property {string} id - The unique identifier of the campaign item
 * @property {string} status - The status of the campaign item (pending, completed, failed, skipped)
 * @property {Date} scheduled_at - When the item is scheduled to be published
 * @property {string} content_type - The type of content (post, story, reel, etc.)
 * @property {string} platform - The social media platform (facebook, instagram, twitter, etc.)
 */

/**
 * @typedef {Object} PublishingCampaign
 * @property {string} id - The unique identifier of the campaign
 * @property {string} name - The name of the campaign
 * @property {string} status - The status of the campaign (draft, preview, active, paused, cancelled, completed)
 * @property {PublishingCampaignItem[]} items - The list of items in the campaign
 * @property {Date} created_at - When the campaign was created
 * @property {Date} updated_at - When the campaign was last updated
 * @property {Date} [completed_at] - When the campaign was completed or cancelled
 * @property {Date} [started_at] - When the campaign was started
 */

/**
 * @typedef {Object} CancelCampaignResponse
 * @property {PublishingCampaign} campaign - The updated campaign object
 * @property {string} message - A message indicating the result of the cancellation
 */

/**
 * Cancel a publishing campaign
 * @route POST /admin/publishing-campaigns/:id/cancel
 * @group PublishingCampaign - Operations related to publishing campaigns
 * @param {string} id.path.required - The ID of the campaign to cancel
 * @returns {CancelCampaignResponse} 200 - The cancelled campaign and a message
 * @throws {MedusaError} 400 - Cannot cancel a campaign with the current status
 * @throws {MedusaError} 404 - Campaign not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * POST /admin/publishing-campaigns/camp_123456789/cancel
 *
 * @example response 200
 * {
 *   "campaign": {
 *     "id": "camp_123456789",
 *     "name": "Summer Sale Campaign",
 *     "status": "cancelled",
 *     "items": [
 *       {
 *         "id": "item_123456789",
 *         "status": "completed",
 *         "scheduled_at": "2023-06-01T10:00:00Z",
 *         "content_type": "post",
 *         "platform": "instagram"
 *       },
 *       {
 *         "id": "item_987654321",
 *         "status": "skipped",
 *         "scheduled_at": "2023-06-02T10:00:00Z",
 *         "content_type": "story",
 *         "platform": "instagram"
 *       }
 *     ],
 *     "created_at": "2023-05-01T00:00:00Z",
 *     "updated_at": "2023-05-15T10:00:00Z",
 *     "completed_at": "2023-05-15T10:00:00Z",
 *     "started_at": "2023-05-10T00:00:00Z"
 *   },
 *   "message": "Campaign cancelled. 1 pending items were skipped."
 * }
 *
 * @example response 400
 * {
 *   "error": "Cannot cancel a campaign with status: completed"
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
 * POST /admin/publishing-campaigns/:id/cancel
 * Cancel a campaign
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const socialsService: SocialsService = req.scope.resolve(SOCIALS_MODULE)
  const { id } = req.params
  
  const [campaign] = await socialsService.listPublishingCampaigns({ id })
  if (!campaign) {
    return res.status(404).json({ error: "Campaign not found" })
  }
  
  const campaignData = campaign as any
  
  // Only allow cancelling active or paused campaigns
  if (!["active", "paused", "draft", "preview"].includes(campaignData.status)) {
    return res.status(400).json({ 
      error: `Cannot cancel a campaign with status: ${campaignData.status}` 
    })
  }
  
  // Mark remaining pending items as skipped
  const items = campaignData.items || []
  const updatedItems = items.map((item: any) => {
    if (item.status === "pending") {
      return { ...item, status: "skipped" }
    }
    return item
  })
  
  // Update campaign status
  const updated = await socialsService.updatePublishingCampaigns({
    id,
    status: "cancelled",
    items: updatedItems as any,
    completed_at: new Date(),
  } as any)
  
  const skippedCount = updatedItems.filter((i: any) => i.status === "skipped").length
  
  return res.json({ 
    campaign: updated,
    message: `Campaign cancelled. ${skippedCount} pending items were skipped.`,
  })
}
