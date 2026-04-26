/**
 * GET /admin/meta-ads/ads/:id
 *
 * Retrieves a Meta ad by ID with its associated ad set, campaign, and ad account.
 *
 * Example Request:
 *   GET /admin/meta-ads/ads/123456789
 *
 * Example Response (200):
 * {
 *   "ad": {
 *     "id": "123456789",
 *     "name": "Summer Collection Ad",
 *     "status": "ACTIVE",
 *     "ad_set_id": "987654321",
 *     "ad_set": {
 *       "id": "987654321",
 *       "name": "Summer Collection Ad Set",
 *       "campaign_id": "567891234",
 *       "campaign": {
 *         "id": "567891234",
 *         "name": "Summer Collection Campaign",
 *         "ad_account_id": "123456789",
 *         "ad_account": {
 *           "id": "123456789",
 *           "name": "Company Ad Account"
 *         }
 *       }
 *     }
 *   }
 * }
 *
 * Error Responses:
 * - 404: Ad not found
 * - 500: Failed to get ad (with error details)
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import SocialsService from "../../../../../modules/socials/service"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const { id } = req.params

    const ad = await socials.retrieveAd(id)

    if (!ad) {
      return res.status(404).json({
        message: "Ad not found",
      })
    }

    const adSetId = (ad as any).ad_set_id
    const adSet = adSetId ? await socials.retrieveAdSet(adSetId) : null

    const campaignId = adSet ? (adSet as any).campaign_id : null
    const campaign = campaignId ? await socials.retrieveAdCampaign(campaignId) : null

    const adAccountId = campaign ? (campaign as any).ad_account_id : null
    const adAccount = adAccountId ? await socials.retrieveAdAccount(adAccountId) : null

    res.json({
      ad: {
        ...(ad as any),
        ad_set: adSet,
        campaign,
        ad_account: adAccount,
      },
    })
  } catch (error: any) {
    console.error("Failed to get ad:", error)

    if (error.type === "not_found" || error.message?.includes("was not found")) {
      return res.status(404).json({
        message: "Ad not found",
      })
    }

    res.status(500).json({
      message: "Failed to get ad",
      error: error.message,
    })
  }
}
