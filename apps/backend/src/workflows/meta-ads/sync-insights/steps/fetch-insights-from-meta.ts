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
  includeBreakdowns?: boolean
}

// Fields to request from Meta API
const INSIGHT_FIELDS = [
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "date_start",
  "date_stop",
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

const BREAKDOWN_FIELDS = [
  "campaign_id",
  "adset_id",
  "ad_id",
  "date_start",
  "date_stop",
  "impressions",
  "reach",
  "clicks",
  "spend",
  "actions",
  "cpc",
  "cpm",
  "ctr",
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

    let insights = (insightsResponse as any).data || []

    if (input.includeBreakdowns) {
      const breakdownSets: string[][] = [
        ["age", "gender"],
        ["country"],
        ["publisher_platform"],
        ["platform_position"],
        ["device_platform"],
      ]

      for (const breakdowns of breakdownSets) {
        try {
          const resp = await metaAds.getInsights(
            input.adAccount.meta_account_id,
            input.platform.accessToken,
            {
              level: input.level as "account" | "campaign" | "adset" | "ad",
              date_preset: input.datePreset,
              time_increment: parseInt(input.timeIncrement) || 1,
              breakdowns,
              fields: BREAKDOWN_FIELDS,
            }
          )

          const rows = (resp as any).data || []
          insights = insights.concat(rows)
        } catch (e) {
          // Ignore invalid breakdown combinations for some accounts
        }
      }
    }

    console.log(`[SyncInsights] Fetched ${insights.length} insight records from Meta`)

    return new StepResponse({
      insights: insights as InsightRecord[],
      adAccount: input.adAccount,
      level: input.level,
      timeIncrement: input.timeIncrement,
    })
  }
)
