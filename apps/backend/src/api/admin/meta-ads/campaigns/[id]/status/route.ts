/**
 * @file Admin API route for updating Meta Ads campaign status
 * @description Provides endpoints for pausing and resuming Meta Ads campaigns in the JYT Commerce platform
 * @module API/Admin/MetaAds/Campaigns
 */

/**
 * @typedef {Object} CampaignStatusUpdate
 * @property {"ACTIVE" | "PAUSED"} status - The desired status of the campaign. "ACTIVE" to resume, "PAUSED" to pause.
 */

/**
 * @typedef {Object} CampaignStatusResponse
 * @property {string} message - Success message indicating the action taken
 * @property {Object} campaign - The updated campaign object
 * @property {string} campaign.id - The unique identifier of the campaign
 * @property {string} campaign.status - The current status of the campaign ("ACTIVE" or "PAUSED")
 * @property {string} campaign.configured_status - The configured status of the campaign
 * @property {string} campaign.meta_campaign_id - The Meta Ads campaign ID
 * @property {string} campaign.ad_account_id - The associated ad account ID
 * @property {Date} campaign.created_at - When the campaign was created
 * @property {Date} campaign.updated_at - When the campaign was last updated
 */

/**
 * Update Meta Ads campaign status
 * @route POST /admin/meta-ads/campaigns/:id/status
 * @group MetaAds/Campaigns - Operations related to Meta Ads campaigns
 * @param {string} id.path.required - The unique identifier of the campaign to update
 * @param {CampaignStatusUpdate} request.body.required - Campaign status update data
 * @returns {CampaignStatusResponse} 200 - Updated campaign status and details
 * @throws {MedusaError} 400 - Invalid status value or missing access token
 * @throws {MedusaError} 404 - Campaign, ad account, or platform not found
 * @throws {MedusaError} 500 - Failed to update campaign status
 *
 * @example request
 * POST /admin/meta-ads/campaigns/camp_123456789/status
 * {
 *   "status": "PAUSED"
 * }
 *
 * @example response 200
 * {
 *   "message": "Campaign paused successfully",
 *   "campaign": {
 *     "id": "camp_123456789",
 *     "status": "PAUSED",
 *     "configured_status": "PAUSED",
 *     "meta_campaign_id": "23843375698374654",
 *     "ad_account_id": "act_987654321",
 *     "created_at": "2023-01-15T10:30:00Z",
 *     "updated_at": "2023-05-20T14:45:00Z"
 *   }
 * }
 *
 * @example request
 * POST /admin/meta-ads/campaigns/camp_987654321/status
 * {
 *   "status": "ACTIVE"
 * }
 *
 * @example response 200
 * {
 *   "message": "Campaign resumed successfully",
 *   "campaign": {
 *     "id": "camp_987654321",
 *     "status": "ACTIVE",
 *     "configured_status": "ACTIVE",
 *     "meta_campaign_id": "23843375698374655",
 *     "ad_account_id": "act_123456789",
 *     "created_at": "2023-02-20T09:15:00Z",
 *     "updated_at": "2023-05-20T15:30:00Z"
 *   }
 * }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../../../modules/socials"
import SocialsService from "../../../../../../modules/socials/service"
import MetaAdsService from "../../../../../../modules/social-provider/meta-ads-service"
import { decryptAccessToken } from "../../../../../../modules/socials/utils/token-helpers"

/**
 * POST /admin/meta-ads/campaigns/:id/status
 * 
 * Update campaign status (pause/resume)
 * 
 * Body:
 * - status: "ACTIVE" | "PAUSED"
 */
export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const { id } = req.params
    const { status } = req.body as { status: "ACTIVE" | "PAUSED" }

    if (!status || !["ACTIVE", "PAUSED"].includes(status)) {
      return res.status(400).json({
        message: "Invalid status. Must be 'ACTIVE' or 'PAUSED'",
      })
    }

    // Get campaign
    const campaign = await socials.retrieveAdCampaign(id)
    if (!campaign) {
      return res.status(404).json({
        message: "Campaign not found",
      })
    }

    // Get ad account to find platform
    const adAccount = await socials.retrieveAdAccount((campaign as any).ad_account_id)
    if (!adAccount) {
      return res.status(404).json({
        message: "Ad account not found",
      })
    }

    // Get platform for access token
    const platform = await socials.retrieveSocialPlatform((adAccount as any).platform_id)
    if (!platform) {
      return res.status(404).json({
        message: "Platform not found",
      })
    }

    const apiConfig = (platform as any).api_config
    const accessToken = decryptAccessToken(apiConfig, req.scope)
    
    if (!accessToken) {
      return res.status(400).json({
        message: "No access token available",
      })
    }

    // Update status on Meta
    const metaAds = new MetaAdsService()
    const metaCampaignId = (campaign as any).meta_campaign_id

    await metaAds.setCampaignStatus(metaCampaignId, status, accessToken)

    // Update local database
    await socials.updateAdCampaigns([{
      selector: { id },
      data: { 
        status,
        configured_status: status,
      },
    }])

    // Fetch updated campaign
    const updatedCampaign = await socials.retrieveAdCampaign(id)

    res.json({
      message: `Campaign ${status === "ACTIVE" ? "resumed" : "paused"} successfully`,
      campaign: updatedCampaign,
    })
  } catch (error: any) {
    console.error("Failed to update campaign status:", error)
    res.status(500).json({
      message: "Failed to update campaign status",
      error: error.message,
    })
  }
}
