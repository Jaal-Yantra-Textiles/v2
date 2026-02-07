/**
 * @route GET /admin/meta-ads/adsets/{id}
 * @description Retrieve a Meta ad set by ID with associated campaign and ad account
 * @param {string} id - The ID of the ad set to retrieve
 * @returns {object} 200 - Ad set object with campaign and ad account details
 * @returns {object} 404 - Ad set not found
 * @returns {object} 500 - Internal server error
 *
 * @example
 * // Request
 * GET /admin/meta-ads/adsets/23843456789012345
 *
 * @example
 * // Successful response (200)
 * {
 *   "adSet": {
 *     "id": "23843456789012345",
 *     "name": "Summer Collection 2024",
 *     "status": "ACTIVE",
 *     "daily_budget": "10000",
 *     "campaign": {
 *       "id": "12345678901234567",
 *       "name": "Summer Campaign",
 *       "ad_account_id": "act_1234567890"
 *     },
 *     "ad_account": {
 *       "id": "act_1234567890",
 *       "name": "Company Ad Account",
 *       "currency": "USD"
 *     }
 *   }
 * }
 *
 * @example
 * // Not found response (404)
 * {
 *   "message": "Ad set not found"
 * }
 *
 * @example
 * // Error response (500)
 * {
 *   "message": "Failed to get ad set",
 *   "error": "Internal server error details"
 * }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import SocialsService from "../../../../../modules/socials/service"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const { id } = req.params

    const adSet = await socials.retrieveAdSet(id)

    if (!adSet) {
      return res.status(404).json({
        message: "Ad set not found",
      })
    }

    const campaignId = (adSet as any).campaign_id
    const campaign = campaignId ? await socials.retrieveAdCampaign(campaignId) : null

    const adAccountId = campaign ? (campaign as any).ad_account_id : null
    const adAccount = adAccountId ? await socials.retrieveAdAccount(adAccountId) : null

    res.json({
      adSet: {
        ...(adSet as any),
        campaign,
        ad_account: adAccount,
      },
    })
  } catch (error: any) {
    console.error("Failed to get ad set:", error)

    if (error.type === "not_found" || error.message?.includes("was not found")) {
      return res.status(404).json({
        message: "Ad set not found",
      })
    }

    res.status(500).json({
      message: "Failed to get ad set",
      error: error.message,
    })
  }
}
