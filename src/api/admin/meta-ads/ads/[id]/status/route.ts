import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../../../modules/socials"
import SocialsService from "../../../../../../modules/socials/service"
import MetaAdsService from "../../../../../../modules/social-provider/meta-ads-service"
import { decryptAccessToken } from "../../../../../../modules/socials/utils/token-helpers"

/**
 * POST /admin/meta-ads/ads/:id/status
 * 
 * Update ad status (pause/resume)
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

    // Get ad
    const ad = await socials.retrieveAd(id)
    if (!ad) {
      return res.status(404).json({
        message: "Ad not found",
      })
    }

    // Get ad set to find campaign
    const adSet = await socials.retrieveAdSet((ad as any).ad_set_id)
    if (!adSet) {
      return res.status(404).json({
        message: "Ad set not found",
      })
    }

    // Get campaign to find ad account
    const campaign = await socials.retrieveAdCampaign((adSet as any).campaign_id)
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
    const metaAdId = (ad as any).meta_ad_id

    await metaAds.updateAdStatus(metaAdId, status, accessToken)

    // Update local database
    await socials.updateAds([{
      selector: { id },
      data: { status },
    }])

    // Fetch updated ad
    const updatedAd = await socials.retrieveAd(id)

    res.json({
      message: `Ad ${status === "ACTIVE" ? "resumed" : "paused"} successfully`,
      ad: updatedAd,
    })
  } catch (error: any) {
    console.error("Failed to update ad status:", error)
    res.status(500).json({
      message: "Failed to update ad status",
      error: error.message,
    })
  }
}
