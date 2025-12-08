import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import MetaAdsService from "../../../../modules/social-provider/meta-ads-service"
import { PlatformData, AdAccountData, InsightRecord } from "../types"

export const fetchInsightsFromMetaStepId = "fetch-insights-from-meta"

interface FetchInsightsInput {
  platform: PlatformData
  adAccount: AdAccountData
  level: string
  datePreset: string
  timeIncrement: string
}

// Fields to request from Meta API
const INSIGHT_FIELDS = [
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

/**
 * Step 2: Fetch insights from Meta API
 * 
 * This step fetches raw insight data from Meta's Marketing API
 */
export const fetchInsightsFromMetaStep = createStep(
  fetchInsightsFromMetaStepId,
  async (input: FetchInsightsInput, { container }) => {
    const metaAds = new MetaAdsService()

    console.log(`[SyncInsights] Fetching ${input.level} insights from Meta for account ${input.adAccount.meta_account_id}`)

    const insightsResponse = await metaAds.getInsights(
      input.adAccount.meta_account_id,
      input.platform.accessToken,
      {
        level: input.level as "account" | "campaign" | "adset" | "ad",
        date_preset: input.datePreset,
        time_increment: parseInt(input.timeIncrement) || 1,
        fields: INSIGHT_FIELDS,
      }
    )

    const insights = (insightsResponse as any).data || []
    console.log(`[SyncInsights] Fetched ${insights.length} insight records from Meta`)

    return new StepResponse({
      insights: insights as InsightRecord[],
      adAccount: input.adAccount,
      level: input.level,
      timeIncrement: input.timeIncrement,
    })
  }
)
