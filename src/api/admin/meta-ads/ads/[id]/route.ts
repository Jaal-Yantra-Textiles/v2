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
