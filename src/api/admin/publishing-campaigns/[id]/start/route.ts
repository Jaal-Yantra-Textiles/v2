/**
 * @file Admin API route for starting publishing campaigns
 * @description Provides endpoints for starting publishing campaigns in the JYT Commerce platform
 * @module API/Admin/PublishingCampaigns
 */

/**
 * @typedef {Object} PublishingCampaign
 * @property {string} id - The unique identifier of the campaign
 * @property {string} status - The status of the campaign (draft, preview, paused, active)
 * @property {Date} [started_at] - When the campaign was started
 * @property {Date} [paused_at] - When the campaign was paused
 * @property {number} [current_index] - The current index of the campaign
 * @property {Array} [items] - The items to be published in the campaign
 */

/**
 * @typedef {Object} StartCampaignResponse
 * @property {PublishingCampaign} campaign - The updated campaign object
 * @property {string} message - A message indicating the campaign has started
 */

/**
 * Start a publishing campaign
 * @route POST /admin/publishing-campaigns/:id/start
 * @group PublishingCampaign - Operations related to publishing campaigns
 * @param {string} id.path.required - The ID of the campaign to start
 * @returns {StartCampaignResponse} 200 - The updated campaign object and a success message
 * @throws {MedusaError} 400 - Campaign has no items to publish or cannot start a campaign with the current status
 * @throws {MedusaError} 404 - Campaign not found
 *
 * @example request
 * POST /admin/publishing-campaigns/camp_123456789/start
 *
 * @example response 200
 * {
 *   "campaign": {
 *     "id": "camp_123456789",
 *     "status": "active",
 *     "started_at": "2023-01-01T00:00:00Z",
 *     "paused_at": null,
 *     "current_index": 0,
 *     "items": [
 *       {
 *         "id": "item_123456789",
 *         "name": "Sample Item",
 *         "status": "draft"
 *       }
 *     ]
 *   },
 *   "message": "Campaign started. Items will be published according to schedule."
 * }
 *
 * @example response 400
 * {
 *   "error": "Campaign has no items to publish"
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
 * POST /admin/publishing-campaigns/:id/start
 * Start a campaign (set status to active)
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const socialsService: SocialsService = req.scope.resolve(SOCIALS_MODULE)
  const { id } = req.params
  
  const [campaign] = await socialsService.listPublishingCampaigns({ id })
  if (!campaign) {
    return res.status(404).json({ error: "Campaign not found" })
  }
  
  const campaignData = campaign as any
  
  // Only allow starting draft or preview campaigns
  if (!["draft", "preview", "paused"].includes(campaignData.status)) {
    return res.status(400).json({ 
      error: `Cannot start a campaign with status: ${campaignData.status}` 
    })
  }
  
  // Validate campaign has items
  const items = campaignData.items || []
  if (items.length === 0) {
    return res.status(400).json({ error: "Campaign has no items to publish" })
  }
  
  // If resuming from paused, keep current_index
  // If starting fresh, reset to 0
  const currentIndex = campaignData.status === "paused" 
    ? campaignData.current_index 
    : 0
  
  // Update campaign status
  const updated = await socialsService.updatePublishingCampaigns({
    id,
    status: "active",
    started_at: campaignData.started_at || new Date(),
    paused_at: null,
    current_index: currentIndex,
  } as any)
  
  return res.json({ 
    campaign: updated,
    message: "Campaign started. Items will be published according to schedule.",
  })
}
