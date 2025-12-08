import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import SocialsService from "../../../../modules/socials/service"
import { InsightRecord, AdAccountData, SyncInsightsResult } from "../types"

export const saveInsightsToDbStepId = "save-insights-to-db"

interface SaveInsightsInput {
  insights: InsightRecord[]
  adAccount: AdAccountData
  level: string
  timeIncrement: string
}

/**
 * Step 3: Save insights to database
 * 
 * This step processes each insight record and saves/updates it in the database
 */
export const saveInsightsToDbStep = createStep(
  saveInsightsToDbStepId,
  async (input: SaveInsightsInput, { container }) => {
    const socials = container.resolve(SOCIALS_MODULE) as SocialsService
    
    const results: SyncInsightsResult = {
      synced: 0,
      updated: 0,
      errors: 0,
      error_messages: [],
    }

    console.log(`[SyncInsights] Processing ${input.insights.length} insight records`)

    for (const insight of input.insights) {
      try {
        // Parse dates
        const dateStart = insight.date_start ? new Date(insight.date_start) : new Date()
        const dateStop = insight.date_stop ? new Date(insight.date_stop) : new Date()
        
        // Extract actions data
        const actions = insight.actions || []
        const leadAction = actions.find((a) => a.action_type === "lead")
        const leads = leadAction ? parseInt(leadAction.value) : 0
        
        // Extract cost per action
        const costPerAction = insight.cost_per_action_type || []
        const costPerLead = costPerAction.find((a) => a.action_type === "lead")
        
        // Build insight data
        const insightData: Record<string, any> = {
          date_start: dateStart,
          date_stop: dateStop,
          time_increment: input.timeIncrement,
          level: input.level,
          
          meta_account_id: input.adAccount.meta_account_id,
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
          
          currency: input.adAccount.currency,
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

        // Build unique key for deduplication
        const uniqueKey = `${dateStart.toISOString()}_${dateStop.toISOString()}_${input.level}_${insight.campaign_id || ''}_${insight.adset_id || ''}_${insight.ad_id || ''}`
        
        // Check for existing insight
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
          await socials.updateAdInsights([{
            selector: { id: existingId },
            data: insightData,
          }] as any)
          results.updated++
        } else {
          await socials.createAdInsights(insightData as any)
          results.synced++
        }
      } catch (error: any) {
        console.error(`[SyncInsights] Failed to process insight:`, error)
        results.errors++
        results.error_messages.push(error.message)
      }
    }

    console.log(`[SyncInsights] Saved insights: ${results.synced} new, ${results.updated} updated, ${results.errors} errors`)

    return new StepResponse(results)
  }
)
