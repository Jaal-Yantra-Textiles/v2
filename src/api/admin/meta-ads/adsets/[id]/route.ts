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
