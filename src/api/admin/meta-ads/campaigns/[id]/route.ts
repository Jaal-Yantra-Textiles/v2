import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import SocialsService from "../../../../../modules/socials/service"

/**
 * GET /admin/meta-ads/campaigns/:id
 * 
 * Get a single campaign with its ad sets and ads
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const { id } = req.params

    // Get campaign
    const campaign = await socials.retrieveAdCampaign(id)
    
    if (!campaign) {
      return res.status(404).json({
        message: "Campaign not found",
      })
    }

    // Get ad sets for this campaign
    const adSets = await socials.listAdSets({
      campaign_id: id,
    })

    // Get ads for each ad set
    const adSetIds = adSets.map((as: any) => as.id)
    let ads: any[] = []
    
    if (adSetIds.length > 0) {
      // Get all ads for all ad sets
      for (const adSetId of adSetIds) {
        const adSetAds = await socials.listAds({
          ad_set_id: adSetId, // Note: model uses ad_set_id not adset_id
        })
        ads = [...ads, ...adSetAds]
      }
    }

    // Get insights for this campaign using meta_campaign_id
    const metaCampaignId = (campaign as any).meta_campaign_id
    let insights: any[] = []
    
    // List all insights and filter by meta_campaign_id or campaign_id
    const allInsights = await socials.listAdInsights({} as any)
    console.log(`Total insights in DB: ${(allInsights as any[]).length}`)
    
    // Debug: log first few insights to see their structure
    if ((allInsights as any[]).length > 0) {
      const sample = (allInsights as any[])[0]
      console.log(`Sample insight fields: meta_campaign_id=${sample.meta_campaign_id}, campaign_id=${sample.campaign_id}, level=${sample.level}, meta_account_id=${sample.meta_account_id}`)
    }
    
    if (metaCampaignId) {
      insights = (allInsights as any[]).filter((i: any) => {
        // Match by meta_campaign_id or by internal campaign_id
        const matches = i.meta_campaign_id === metaCampaignId || i.campaign_id === id
        return matches
      })
    }
    
    // If no insights found by campaign, try to get all insights for the account
    if (insights.length === 0 && (campaign as any).ad_account_id) {
      const adAccount = await socials.retrieveAdAccount((campaign as any).ad_account_id)
      if (adAccount) {
        const metaAccountId = (adAccount as any).meta_account_id
        console.log(`No campaign insights, trying account ${metaAccountId}`)
        insights = (allInsights as any[]).filter((i: any) => 
          i.meta_account_id === metaAccountId
        )
      }
    }

    console.log(`Found ${insights.length} insights for campaign ${metaCampaignId}`)

    res.json({
      campaign: {
        ...campaign,
        ad_sets: adSets,
        ads,
        insights,
      },
    })
  } catch (error: any) {
    console.error("Failed to get campaign:", error)
    res.status(500).json({
      message: "Failed to get campaign",
      error: error.message,
    })
  }
}
