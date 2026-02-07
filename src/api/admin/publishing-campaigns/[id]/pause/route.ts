/**
 * @file Admin API route for pausing publishing campaigns
 * @description Provides an endpoint to pause active publishing campaigns in the JYT Commerce platform
 * @module API/Admin/PublishingCampaigns
 */

/**
 * @typedef {Object} PauseCampaignResponse
 * @property {Object} campaign - The updated campaign object
 * @property {string} campaign.id - The unique identifier of the campaign
 * @property {string} campaign.status - The status of the campaign (paused)
 * @property {Date} campaign.paused_at - When the campaign was paused
 * @property {string} message - Informational message about the pause operation
 */

/**
 * Pause an active publishing campaign
 * @route POST /admin/publishing-campaigns/:id/pause
 * @group PublishingCampaign - Operations related to publishing campaigns
 * @param {string} id.path.required - The ID of the campaign to pause
 * @returns {PauseCampaignResponse} 200 - Updated campaign object with paused status
 * @throws {MedusaError} 400 - Cannot pause a campaign that is not active
 * @throws {MedusaError} 404 - Campaign not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * POST /admin/publishing-campaigns/camp_123456789/pause
 *
 * @example response 200
 * {
 *   "campaign": {
 *     "id": "camp_123456789",
 *     "status": "paused",
 *     "paused_at": "2023-01-01T12:00:00Z",
 *     "name": "Summer Sale Campaign",
 *     "start_date": "2023-01-01T00:00:00Z",
 *     "end_date": "2023-01-31T23:59:59Z"
 *   },
 *   "message": "Campaign paused. Use /start to resume."
 * }
 *
 * @example response 400
 * {
 *   "error": "Cannot pause a campaign with status: completed"
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
 * POST /admin/publishing-campaigns/:id/pause
 * Pause an active campaign
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const socialsService: SocialsService = req.scope.resolve(SOCIALS_MODULE)
  const { id } = req.params
  
  const [campaign] = await socialsService.listPublishingCampaigns({ id })
  if (!campaign) {
    return res.status(404).json({ error: "Campaign not found" })
  }
  
  const campaignData = campaign as any
  
  // Only allow pausing active campaigns
  if (campaignData.status !== "active") {
    return res.status(400).json({ 
      error: `Cannot pause a campaign with status: ${campaignData.status}` 
    })
  }
  
  // Update campaign status
  const updated = await socialsService.updatePublishingCampaigns({
    id,
    status: "paused",
    paused_at: new Date(),
  } as any)
  
  return res.json({ 
    campaign: updated,
    message: "Campaign paused. Use /start to resume.",
  })
}
