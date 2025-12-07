import { model } from "@medusajs/framework/utils"
import AdCampaign from "./AdCampaign"
import AdSet from "./AdSet"
import Ad from "./Ad"
import AdAccount from "./AdAccount"

/**
 * AdInsights (Meta Ads Performance Data)
 * 
 * Stores time-series performance data for ads, ad sets, campaigns, and accounts.
 * This enables historical tracking and trend analysis.
 * 
 * Data is typically synced daily from Meta Marketing API.
 */
const AdInsights = model.define("AdInsights", {
  id: model.id().primaryKey(),
  
  // ============ TIME PERIOD ============
  // The date range this insight covers
  date_start: model.dateTime(),
  date_stop: model.dateTime(),
  
  // Granularity: daily, weekly, monthly, lifetime
  time_increment: model.text().default("1"), // "1" = daily, "7" = weekly, etc.
  
  // ============ LEVEL ============
  // What level this insight is for
  level: model.enum([
    "account",
    "campaign", 
    "adset",
    "ad"
  ]),
  
  // Meta IDs for the entity
  meta_account_id: model.text().nullable(),
  meta_campaign_id: model.text().nullable(),
  meta_adset_id: model.text().nullable(),
  meta_ad_id: model.text().nullable(),
  
  // ============ CORE METRICS ============
  // Reach & Impressions
  impressions: model.bigNumber().default(0),
  reach: model.bigNumber().default(0),
  frequency: model.float().nullable(), // impressions / reach
  
  // Clicks & Engagement
  clicks: model.bigNumber().default(0),
  unique_clicks: model.bigNumber().nullable(),
  ctr: model.float().nullable(), // click-through rate (%)
  unique_ctr: model.float().nullable(),
  
  // Spend & Cost
  spend: model.bigNumber().default(0), // in account currency
  cpc: model.float().nullable(), // cost per click
  cpm: model.float().nullable(), // cost per 1000 impressions
  cpp: model.float().nullable(), // cost per 1000 people reached
  
  // ============ CONVERSION METRICS ============
  // Actions (leads, purchases, etc.)
  actions: model.json().nullable(),
  /*
    Example actions:
    [
      { "action_type": "lead", "value": "10" },
      { "action_type": "link_click", "value": "150" },
      { "action_type": "page_engagement", "value": "200" }
    ]
  */
  
  // Conversions
  conversions: model.bigNumber().nullable(),
  conversion_rate: model.float().nullable(),
  cost_per_conversion: model.float().nullable(),
  
  // Lead-specific (for lead ads)
  leads: model.bigNumber().nullable(),
  cost_per_lead: model.float().nullable(),
  
  // ============ VIDEO METRICS ============
  video_views: model.bigNumber().nullable(),
  video_p25_watched: model.bigNumber().nullable(), // 25% watched
  video_p50_watched: model.bigNumber().nullable(), // 50% watched
  video_p75_watched: model.bigNumber().nullable(), // 75% watched
  video_p100_watched: model.bigNumber().nullable(), // 100% watched
  video_avg_time_watched: model.float().nullable(), // seconds
  
  // ============ ENGAGEMENT METRICS ============
  post_engagement: model.bigNumber().nullable(),
  post_reactions: model.bigNumber().nullable(),
  post_comments: model.bigNumber().nullable(),
  post_shares: model.bigNumber().nullable(),
  post_saves: model.bigNumber().nullable(),
  
  // ============ QUALITY METRICS ============
  quality_ranking: model.text().nullable(), // BELOW_AVERAGE_10, AVERAGE, etc.
  engagement_rate_ranking: model.text().nullable(),
  conversion_rate_ranking: model.text().nullable(),
  
  // ============ BREAKDOWNS ============
  // Optional breakdown dimensions
  age: model.text().nullable(),
  gender: model.text().nullable(),
  country: model.text().nullable(),
  region: model.text().nullable(),
  platform_position: model.text().nullable(), // feed, stories, reels, etc.
  publisher_platform: model.text().nullable(), // facebook, instagram, audience_network
  device_platform: model.text().nullable(), // mobile, desktop
  
  // ============ RELATIONSHIPS ============
  account: model.belongsTo(() => AdAccount, { mappedBy: "insights" }).nullable(),
  campaign: model.belongsTo(() => AdCampaign, { mappedBy: "insights" }).nullable(),
  adset: model.belongsTo(() => AdSet, { mappedBy: "insights" }).nullable(),
  ad: model.belongsTo(() => Ad, { mappedBy: "insights" }).nullable(),
  
  // ============ METADATA ============
  // Currency and raw data
  currency: model.text().nullable(),
  
  // Raw API response for debugging
  raw_data: model.json().nullable(),
  
  // Sync tracking
  synced_at: model.dateTime(),
})

export default AdInsights
