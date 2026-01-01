/**
 * Types for Meta Ads Insights Sync Workflow
 */

export interface SyncInsightsInput {
  platform_id: string
  ad_account_id: string
  level?: "campaign" | "adset" | "ad"
  date_preset?: "last_7d" | "last_14d" | "last_30d" | "last_90d" | "maximum"
  time_increment?: string
  include_breakdowns?: boolean
}

export interface SyncInsightsResult {
  synced: number
  updated: number
  errors: number
  error_messages: string[]
}

export interface PlatformData {
  id: string
  name: string
  accessToken: string
}

export interface AdAccountData {
  id: string
  meta_account_id: string
  name: string
  currency: string
}

export interface InsightRecord {
  campaign_id?: string
  adset_id?: string
  ad_id?: string
  date_start: string
  date_stop: string
  impressions: string
  reach: string
  clicks: string
  spend: string
  ctr?: string
  cpc?: string
  cpm?: string
  cpp?: string
  frequency?: string
  unique_clicks?: string
  unique_ctr?: string
  actions?: Array<{ action_type: string; value: string }>
  cost_per_action_type?: Array<{ action_type: string; value: string }>
  quality_ranking?: string
  engagement_rate_ranking?: string
  conversion_rate_ranking?: string
  video_p25_watched_actions?: Array<{ value: string }>
  video_p50_watched_actions?: Array<{ value: string }>
  video_p75_watched_actions?: Array<{ value: string }>
  video_p100_watched_actions?: Array<{ value: string }>

  // Optional breakdown dimensions
  age?: string
  gender?: string
  country?: string
  region?: string
  publisher_platform?: string
  platform_position?: string
  device_platform?: string
}

export interface AggregatedMetrics {
  impressions: number
  reach: number
  clicks: number
  spend: number
  leads: number
  conversions?: number
}
