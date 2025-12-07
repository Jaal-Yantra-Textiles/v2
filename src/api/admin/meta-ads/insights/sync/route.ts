import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import SocialsService from "../../../../../modules/socials/service"
import MetaAdsService from "../../../../../modules/social-provider/meta-ads-service"
import { decryptAccessToken } from "../../../../../modules/socials/utils/token-helpers"

/**
 * POST /admin/meta-ads/insights/sync
 * 
 * Sync historical insights from Meta for campaigns, ad sets, and ads.
 * 
 * Body:
 * - platform_id: Platform ID to sync from (required)
 * - ad_account_id: Ad account ID to sync (required)
 * - level: "campaign" | "adset" | "ad" (default: "campaign")
 * - date_preset: "last_7d" | "last_14d" | "last_30d" | "last_90d" | "maximum" (default: "last_30d")
 * - time_increment: "1" (daily) | "7" (weekly) | "monthly" | "all_days" (default: "1")
 */
export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const body = req.body as Record<string, any>
    
    const { 
      platform_id, 
      ad_account_id,
      level = "campaign",
      date_preset = "last_30d",
      time_increment = "1"
    } = body

    if (!platform_id) {
      return res.status(400).json({ message: "platform_id is required" })
    }
    
    if (!ad_account_id) {
      return res.status(400).json({ message: "ad_account_id is required" })
    }

    // Get platform and access token
    const platform = await socials.retrieveSocialPlatform(platform_id)
    
    if (!platform) {
      return res.status(404).json({ message: "Platform not found" })
    }

    const apiConfig = platform.api_config as any
    if (!apiConfig) {
      return res.status(400).json({ message: "Platform has no API configuration" })
    }

    const accessToken = decryptAccessToken(apiConfig, req.scope)
    
    if (!accessToken) {
      return res.status(400).json({ message: "No access token available" })
    }

    // Get ad account
    const adAccounts = await socials.listAdAccounts({ meta_account_id: ad_account_id })
    const adAccount = adAccounts[0]
    
    if (!adAccount) {
      return res.status(404).json({ message: "Ad account not found" })
    }

    const metaAds = new MetaAdsService()
    const results = {
      synced: 0,
      updated: 0,
      errors: 0,
      error_messages: [] as string[],
    }

    // Map date_preset to Meta API format
    const datePresetMap: Record<string, string> = {
      "last_7d": "last_7d",
      "last_14d": "last_14d", 
      "last_30d": "last_30d",
      "last_90d": "last_90d",
      "maximum": "maximum",
    }

    const metaDatePreset = datePresetMap[date_preset] || "last_30d"

    // Fields to request from Meta - include entity IDs for proper linking
    const insightFields = [
      "campaign_id",
      "campaign_name",
      "adset_id",
      "adset_name", 
      "ad_id",
      "ad_name",
      "impressions",
      "reach",
      "frequency",
      "clicks",
      "unique_clicks",
      "ctr",
      "unique_ctr",
      "spend",
      "cpc",
      "cpm",
      "cpp",
      "actions",
      "conversions",
      "cost_per_action_type",
      "video_p25_watched_actions",
      "video_p50_watched_actions",
      "video_p75_watched_actions",
      "video_p100_watched_actions",
      "video_avg_time_watched_actions",
      "quality_ranking",
      "engagement_rate_ranking",
      "conversion_rate_ranking",
    ]

    try {
      // Fetch insights from Meta
      const insightsResponse = await metaAds.getInsights(
        ad_account_id,
        accessToken,
        {
          level: level as "account" | "campaign" | "adset" | "ad",
          date_preset: metaDatePreset,
          time_increment: parseInt(time_increment) || 1,
          fields: insightFields,
        }
      )

      const insights = (insightsResponse as any).data || []
      console.log(`Fetched ${insights.length} insight records from Meta`)
      
      // Debug: log first insight to see structure
      if (insights.length > 0) {
        console.log(`Sample insight: campaign_id=${insights[0].campaign_id}, date_start=${insights[0].date_start}`)
      }

      for (const insight of insights) {
        try {
          // Parse dates
          const dateStart = insight.date_start ? new Date(insight.date_start) : new Date()
          const dateStop = insight.date_stop ? new Date(insight.date_stop) : new Date()
          
          // Extract actions data
          const actions = insight.actions || []
          const leadAction = actions.find((a: any) => a.action_type === "lead")
          const leads = leadAction ? parseInt(leadAction.value) : 0
          
          // Extract cost per action
          const costPerAction = insight.cost_per_action_type || []
          const costPerLead = costPerAction.find((a: any) => a.action_type === "lead")
          
          // Build insight data
          const insightData: Record<string, any> = {
            date_start: dateStart,
            date_stop: dateStop,
            time_increment,
            level,
            
            meta_account_id: ad_account_id,
            meta_campaign_id: insight.campaign_id || null,
            meta_adset_id: insight.adset_id || null,
            meta_ad_id: insight.ad_id || null,
            
            impressions: parseInt(insight.impressions || "0") || 0,
            reach: parseInt(insight.reach || "0") || 0,
            frequency: insight.frequency ? parseFloat(insight.frequency) : null,
            
            clicks: parseInt(insight.clicks || "0") || 0,
            unique_clicks: insight.unique_clicks ? parseInt(insight.unique_clicks) : null,
            ctr: insight.ctr ? parseFloat(insight.ctr) : null,
            unique_ctr: insight.unique_ctr ? parseFloat(insight.unique_ctr) : null,
            
            spend: parseFloat(insight.spend || "0") || 0,
            cpc: insight.cpc ? parseFloat(insight.cpc) : null,
            cpm: insight.cpm ? parseFloat(insight.cpm) : null,
            cpp: insight.cpp ? parseFloat(insight.cpp) : null,
            
            actions: insight.actions || null,
            leads,
            cost_per_lead: costPerLead ? parseFloat(costPerLead.value) : null,
            
            // Video metrics
            video_p25_watched: insight.video_p25_watched_actions?.[0]?.value || null,
            video_p50_watched: insight.video_p50_watched_actions?.[0]?.value || null,
            video_p75_watched: insight.video_p75_watched_actions?.[0]?.value || null,
            video_p100_watched: insight.video_p100_watched_actions?.[0]?.value || null,
            
            // Quality metrics
            quality_ranking: insight.quality_ranking || null,
            engagement_rate_ranking: insight.engagement_rate_ranking || null,
            conversion_rate_ranking: insight.conversion_rate_ranking || null,
            
            currency: adAccount.currency,
            raw_data: insight,
            synced_at: new Date(),
          }

          // Link to internal entities if they exist
          if (insight.campaign_id) {
            const campaigns = await socials.listAdCampaigns({ meta_campaign_id: insight.campaign_id })
            if (campaigns[0]) {
              insightData.campaign_id = campaigns[0].id
            }
          }
          
          if (insight.adset_id) {
            const adsets = await socials.listAdSets({ meta_adset_id: insight.adset_id })
            if (adsets[0]) {
              insightData.adset_id = adsets[0].id
            }
          }
          
          if (insight.ad_id) {
            const ads = await socials.listAds({ meta_ad_id: insight.ad_id })
            if (ads[0]) {
              insightData.ad_id = ads[0].id
            }
          }

          // Check if insight already exists for this date/entity combination
          // Build a unique key based on date range and entity
          const uniqueKey = `${dateStart.toISOString()}_${dateStop.toISOString()}_${level}_${insight.campaign_id || ''}_${insight.adset_id || ''}_${insight.ad_id || ''}`
          
          // Try to find existing by meta IDs and date range
          let existingId: string | null = null
          try {
            const existingInsights = await socials.listAdInsights({} as any)
            const existing = (existingInsights as any[]).find((ei: any) => {
              if (!ei.date_start || !ei.date_stop) return false
              const eiStart = new Date(ei.date_start).toISOString()
              const eiStop = new Date(ei.date_stop).toISOString()
              const eiKey = `${eiStart}_${eiStop}_${ei.level || ''}_${ei.meta_campaign_id || ''}_${ei.meta_adset_id || ''}_${ei.meta_ad_id || ''}`
              return eiKey === uniqueKey
            })
            if (existing?.id) {
              existingId = existing.id
            }
          } catch (e) {
            // If listing fails, just create new
          }

          if (existingId) {
            // Update existing
            await socials.updateAdInsights([{
              selector: { id: existingId },
              data: insightData,
            }] as any)
            results.updated++
          } else {
            // Create new
            await socials.createAdInsights(insightData as any)
            results.synced++
          }
        } catch (error: any) {
          console.error(`Failed to process insight:`, error)
          results.errors++
          results.error_messages.push(error.message)
        }
      }

      // Also update the snapshot metrics on the parent entities
      if (level === "campaign") {
        await updateCampaignMetrics(socials, metaAds, ad_account_id, accessToken)
      }

    } catch (error: any) {
      console.error("Failed to fetch insights from Meta:", error)
      results.errors++
      results.error_messages.push(error.message)
    }

    // Return appropriate status
    if (results.errors > 0 && results.synced === 0 && results.updated === 0) {
      return res.status(400).json({
        message: "Failed to sync insights",
        results,
      })
    }

    res.json({
      message: results.errors > 0 
        ? `Sync completed with ${results.errors} error(s)` 
        : "Insights sync completed",
      results,
    })
  } catch (error: any) {
    console.error("Failed to sync insights:", error)
    res.status(500).json({
      message: "Failed to sync insights",
      error: error.message,
    })
  }
}

/**
 * Update campaign-level metrics with lifetime totals
 */
async function updateCampaignMetrics(
  socials: SocialsService,
  metaAds: MetaAdsService,
  adAccountId: string,
  accessToken: string
) {
  try {
    // Get lifetime insights for all campaigns
    const insightsResponse = await metaAds.getInsights(adAccountId, accessToken, {
      level: "campaign",
      date_preset: "maximum",
      time_increment: 1, // all_days equivalent
      fields: ["campaign_id", "impressions", "reach", "clicks", "spend", "ctr", "cpc", "cpm", "actions"],
    })

    const insights = (insightsResponse as any).data || []

    for (const insight of insights) {
      if (!insight.campaign_id) continue

      const campaigns = await socials.listAdCampaigns({ meta_campaign_id: insight.campaign_id })
      const campaign = campaigns[0] as any
      if (!campaign?.id) continue

      const actions = insight.actions || []
      const leadAction = actions.find((a: any) => a.action_type === "lead")
      const leads = leadAction ? parseInt(leadAction.value) : 0
      const costPerLead = leads > 0 ? parseFloat(insight.spend || "0") / leads : null

      try {
        await socials.updateAdCampaigns([{
          selector: { id: campaign.id },
          data: {
            impressions: parseInt(insight.impressions || "0") || 0,
            reach: parseInt(insight.reach || "0") || 0,
            clicks: parseInt(insight.clicks || "0") || 0,
            spend: parseFloat(insight.spend || "0") || 0,
            leads,
            ctr: insight.ctr ? parseFloat(insight.ctr) : null,
            cpc: insight.cpc ? parseFloat(insight.cpc) : null,
            cpm: insight.cpm ? parseFloat(insight.cpm) : null,
            cost_per_lead: costPerLead,
            last_synced_at: new Date(),
          },
        }])
      } catch (e) {
        console.error(`Failed to update campaign ${campaign.id}:`, e)
      }
    }
  } catch (error) {
    console.error("Failed to update campaign metrics:", error)
  }
}
