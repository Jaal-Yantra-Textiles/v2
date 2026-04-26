export type InsightRow = Record<string, any>

export type AggregateTotals = {
  impressions: number
  reach: number
  clicks: number
  spend: number
  ctr: number
  cpc: number
  cpm: number
}

export type BreakdownGroup = {
  key: Record<string, string>
  totals: AggregateTotals
  results: Record<string, number>
}

export type FetchOverviewInput = {
  platform_id: string
  ad_account_id: string
  level: "account" | "campaign" | "adset" | "ad"
  /** Resolved object ID: ad_account_id for level=account, otherwise object_id */
  objectId: string
  date_preset: string
  time_increment: number
  include_audience: boolean
  include_content: boolean
  persist: boolean
  refresh: "auto" | "force" | "never"
  max_age_minutes: number
}

export type FetchedRows = {
  baseRows: InsightRow[]
  ageGenderRows: InsightRow[]
  countryRows: InsightRow[]
  publisherRows: InsightRow[]
  positionRows: InsightRow[]
  deviceRows: InsightRow[]
}

export type FetchOverviewOutput = {
  scope: Record<string, any>
  totals: AggregateTotals
  results: Record<string, number>
  audience: {
    by_age_gender: BreakdownGroup[]
    by_country: BreakdownGroup[]
  } | null
  content: {
    by_publisher_platform: BreakdownGroup[]
    by_platform_position: BreakdownGroup[]
    by_device_platform: BreakdownGroup[]
  } | null
  capabilities: {
    remote_ad_creation: { supported: boolean }
  }
  persistence: {
    enabled: boolean
    created: number
    updated: number
    errors: number
  }
  data_source: "db" | "meta"
}
