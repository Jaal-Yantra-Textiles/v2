import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import SocialsService from "../../../../../modules/socials/service"
import MetaAdsService from "../../../../../modules/social-provider/meta-ads-service"
import { decryptAccessToken } from "../../../../../modules/socials/utils/token-helpers"

/**
 * POST /admin/meta-ads/campaigns/sync
 * 
 * Sync campaigns from Meta for an ad account
 * 
 * Body:
 * - ad_account_id: Internal ad account ID (required)
 * - include_insights: Whether to fetch insights (optional, default false)
 */
export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const body = req.body as Record<string, any>
    
    const { ad_account_id, include_insights = false } = body

    if (!ad_account_id) {
      return res.status(400).json({
        message: "ad_account_id is required",
      })
    }

    // Get ad account
    const adAccount = await socials.retrieveAdAccount(ad_account_id)
    
    if (!adAccount) {
      return res.status(404).json({
        message: "Ad account not found",
      })
    }

    // Get platform and access token
    const platform = await socials.retrieveSocialPlatform((adAccount as any).platform_id)
    
    if (!platform) {
      return res.status(404).json({
        message: "Platform not found",
      })
    }

    const apiConfig = platform.api_config as any
    const accessToken = decryptAccessToken(apiConfig, req.scope)
    
    if (!accessToken) {
      return res.status(400).json({
        message: "No access token available",
      })
    }

    const metaAds = new MetaAdsService()
    const results = {
      created: 0,
      updated: 0,
      errors: 0,
    }

    // Fetch campaigns from Meta
    const metaCampaigns = await metaAds.listCampaigns(
      (adAccount as any).meta_account_id,
      accessToken
    )

    console.log(`Found ${metaCampaigns.length} campaigns from Meta`)

    for (const metaCampaign of metaCampaigns) {
      try {
        // Check if campaign already exists
        const existingCampaigns = await socials.listAdCampaigns({
          meta_campaign_id: metaCampaign.id,
        })

        // Fetch insights if requested
        let insights: any = null
        if (include_insights) {
          try {
            insights = await metaAds.getInsights(metaCampaign.id, accessToken, {
              date_preset: "last_30d",
            })
          } catch (e) {
            console.warn(`Failed to get insights for campaign ${metaCampaign.id}`)
          }
        }

        const campaignData: Record<string, any> = {
          meta_campaign_id: metaCampaign.id,
          name: metaCampaign.name,
          objective: metaCampaign.objective || "OTHER",
          status: metaCampaign.status || "PAUSED",
          effective_status: metaCampaign.effective_status || null,
          configured_status: metaCampaign.configured_status || null,
          buying_type: metaCampaign.buying_type || "AUCTION",
          daily_budget: metaCampaign.daily_budget ? parseFloat(metaCampaign.daily_budget) / 100 : null,
          lifetime_budget: metaCampaign.lifetime_budget ? parseFloat(metaCampaign.lifetime_budget) / 100 : null,
          budget_remaining: metaCampaign.budget_remaining ? parseFloat(metaCampaign.budget_remaining) / 100 : null,
          special_ad_categories: metaCampaign.special_ad_categories || null,
          start_time: metaCampaign.start_time ? new Date(metaCampaign.start_time) : null,
          stop_time: metaCampaign.stop_time ? new Date(metaCampaign.stop_time) : null,
          last_synced_at: new Date(),
          ad_account_id: ad_account_id,
        }

        // Add insights data if available
        if (insights?.data?.[0]) {
          const insightData = insights.data[0]
          campaignData.impressions = parseInt(insightData.impressions || "0", 10)
          campaignData.clicks = parseInt(insightData.clicks || "0", 10)
          campaignData.spend = parseFloat(insightData.spend || "0")
          campaignData.reach = parseInt(insightData.reach || "0", 10)
          campaignData.cpc = insightData.cpc ? parseFloat(insightData.cpc) : null
          campaignData.cpm = insightData.cpm ? parseFloat(insightData.cpm) : null
          campaignData.ctr = insightData.ctr ? parseFloat(insightData.ctr) : null
          
          // Extract lead count from actions
          campaignData.leads = metaAds.extractLeadCount(insights)
        }

        if (existingCampaigns.length > 0) {
          await socials.updateAdCampaigns([{
            selector: { id: existingCampaigns[0].id },
            data: campaignData,
          }])
          results.updated++
        } else {
          await socials.createAdCampaigns(campaignData as any)
          results.created++
        }
      } catch (error) {
        console.error(`Failed to sync campaign ${metaCampaign.id}:`, error)
        results.errors++
      }
    }

    res.json({
      message: "Campaign sync completed",
      results,
    })
  } catch (error: any) {
    console.error("Failed to sync campaigns:", error)
    res.status(500).json({
      message: "Failed to sync campaigns",
      error: error.message,
    })
  }
}
