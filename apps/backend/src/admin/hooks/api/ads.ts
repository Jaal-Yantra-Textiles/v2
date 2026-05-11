import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../../lib/config"

// Backend serves the new unified `/admin/ads/*` surface (PR #215). Same hook
// file backs every tab on `/admin/ads`; the platform discriminator on each
// response tells the UI which native row shape lives under `.raw` if it
// wants a network-specific extra.

// ───────────────────────────── Types ─────────────────────────────

export type AdsPlatformKind = "meta" | "google"

export interface AdsAccount {
  id: string
  platform: AdsPlatformKind
  provider_account_id: string
  name: string
  currency: string | null
  status: string
  last_synced_at: string | null
  raw: Record<string, any>
}

export interface AdsCampaign {
  id: string
  platform: AdsPlatformKind
  account_id: string
  provider_campaign_id: string
  name: string
  status: string
  objective_or_channel_type: string | null
  start_date: string | null
  end_date: string | null
  budget_micros: number
  impressions: number
  clicks: number
  conversions: number
  cost_micros: number
  last_synced_at: string | null
  raw: Record<string, any>
}

export interface AdsAdGroup {
  id: string
  platform: AdsPlatformKind
  campaign_id: string
  provider_ad_group_id: string
  name: string
  status: string
  type: string | null
  impressions: number
  clicks: number
  conversions: number
  cost_micros: number
  last_synced_at: string | null
  raw: Record<string, any>
}

export interface AdsAd {
  id: string
  platform: AdsPlatformKind
  ad_group_id: string
  provider_ad_id: string
  name: string | null
  status: string
  type: string | null
  headlines: Array<{ text?: string }> | null
  descriptions: Array<{ text?: string }> | null
  final_urls: string[] | null
  image_url: string | null
  video_id: string | null
  display_url: string | null
  impressions: number
  clicks: number
  conversions: number
  cost_micros: number
  last_synced_at: string | null
  raw: Record<string, any>
}

export type AdsInsightLevel =
  | "customer"
  | "account"
  | "campaign"
  | "ad_group"
  | "adset"
  | "ad"

export interface AdsInsight {
  id: string
  platform: AdsPlatformKind
  level: string
  date: string | null
  entity_id: string | null
  impressions: number
  clicks: number
  ctr: number | null
  cost_micros: number
  average_cpc_micros: number
  average_cpm_micros: number
  conversions: number
  conversions_value: number | null
  all_conversions: number | null
  view_through_conversions: number | null
  video_views: number
  video_view_rate: number | null
  engagements: number
  engagement_rate: number | null
  device: string | null
  network: string | null
  currency_code: string | null
  raw: Record<string, any>
}

export interface SyncResult {
  platform_id: string
  customers_synced?: number
  campaigns_synced?: number
  ad_groups_synced?: number
  ads_synced?: number
  insights_rows_synced?: number
  errors?: Array<{ customer_id: string; message: string }>
}

// ───────────────────────────── Query keys ─────────────────────────────

export const adsKeys = {
  all: ["ads"] as const,
  platforms: () => [...adsKeys.all, "platforms"] as const,
  accounts: (params: object) => [...adsKeys.all, "accounts", params] as const,
  campaigns: (params: object) => [...adsKeys.all, "campaigns", params] as const,
  adGroups: (params: object) => [...adsKeys.all, "ad-groups", params] as const,
  adsList: (params: object) => [...adsKeys.all, "ads", params] as const,
  insights: (params: object) => [...adsKeys.all, "insights", params] as const,
}

// ───────────────────────────── Platforms (for picker) ─────────────────────────────

export interface PlatformOption {
  id: string
  name: string
  category: string
  kind: AdsPlatformKind
}

/**
 * Lists every SocialPlatform that could plausibly back the ads UI:
 *   - category === "google"   → Google Ads
 *   - name contains facebook/instagram/meta → Meta Ads (current convention)
 *
 * If/when there's a cleaner discriminator on the row, this is the single
 * place to update.
 */
export const useAdsPlatforms = () => {
  return useQuery({
    queryKey: adsKeys.platforms(),
    queryFn: async () => {
      const response = await sdk.client.fetch<{
        socialPlatforms: Array<{ id: string; name: string; category: string }>
      }>("/admin/social-platforms", { query: { limit: 100 } })

      const options: PlatformOption[] = []
      for (const p of response.socialPlatforms || []) {
        const category = (p.category || "").toLowerCase()
        const name = (p.name || "").toLowerCase()
        if (category === "google") {
          options.push({ id: p.id, name: p.name, category, kind: "google" })
        } else if (
          name.includes("facebook") ||
          name.includes("instagram") ||
          name.includes("meta")
        ) {
          options.push({ id: p.id, name: p.name, category, kind: "meta" })
        }
      }
      return options
    },
  })
}

// ───────────────────────────── Resource lists ─────────────────────────────

type ListParams = {
  platform_id: string
  limit?: number
  offset?: number
}

export const useAdsAccounts = (params: ListParams) => {
  return useQuery({
    queryKey: adsKeys.accounts(params),
    enabled: !!params.platform_id,
    queryFn: async () => {
      const query: Record<string, string> = { platform_id: params.platform_id }
      if (params.limit) query.limit = String(params.limit)
      if (params.offset !== undefined) query.offset = String(params.offset)
      return sdk.client.fetch<{
        platform: AdsPlatformKind
        accounts: AdsAccount[]
        count: number
      }>("/admin/ads/accounts", { query })
    },
  })
}

export const useAdsCampaigns = (
  params: ListParams & { account_id?: string }
) => {
  return useQuery({
    queryKey: adsKeys.campaigns(params),
    enabled: !!params.platform_id,
    queryFn: async () => {
      const query: Record<string, string> = { platform_id: params.platform_id }
      if (params.account_id) query.account_id = params.account_id
      if (params.limit) query.limit = String(params.limit)
      if (params.offset !== undefined) query.offset = String(params.offset)
      return sdk.client.fetch<{
        platform: AdsPlatformKind
        campaigns: AdsCampaign[]
        count: number
      }>("/admin/ads/campaigns", { query })
    },
  })
}

export const useAdsAdGroups = (
  params: ListParams & { campaign_id?: string }
) => {
  return useQuery({
    queryKey: adsKeys.adGroups(params),
    enabled: !!params.platform_id,
    queryFn: async () => {
      const query: Record<string, string> = { platform_id: params.platform_id }
      if (params.campaign_id) query.campaign_id = params.campaign_id
      if (params.limit) query.limit = String(params.limit)
      if (params.offset !== undefined) query.offset = String(params.offset)
      return sdk.client.fetch<{
        platform: AdsPlatformKind
        ad_groups: AdsAdGroup[]
        count: number
      }>("/admin/ads/ad-groups", { query })
    },
  })
}

export const useAdsList = (
  params: ListParams & { ad_group_id?: string }
) => {
  return useQuery({
    queryKey: adsKeys.adsList(params),
    enabled: !!params.platform_id,
    queryFn: async () => {
      const query: Record<string, string> = { platform_id: params.platform_id }
      if (params.ad_group_id) query.ad_group_id = params.ad_group_id
      if (params.limit) query.limit = String(params.limit)
      if (params.offset !== undefined) query.offset = String(params.offset)
      return sdk.client.fetch<{
        platform: AdsPlatformKind
        ads: AdsAd[]
        count: number
      }>("/admin/ads/ads", { query })
    },
  })
}

export const useAdsInsights = (params: {
  platform_id: string
  level?: AdsInsightLevel | string
  entity_id?: string
  from?: string
  to?: string
  breakdown?: "device" | "network"
  limit?: number
}) => {
  return useQuery({
    queryKey: adsKeys.insights(params),
    enabled: !!params.platform_id,
    queryFn: async () => {
      const query: Record<string, string> = { platform_id: params.platform_id }
      if (params.level) query.level = String(params.level)
      if (params.entity_id) query.entity_id = params.entity_id
      if (params.from) query.from = params.from
      if (params.to) query.to = params.to
      if (params.breakdown) query.breakdown = params.breakdown
      if (params.limit) query.limit = String(params.limit)
      return sdk.client.fetch<{
        platform: AdsPlatformKind
        level: string
        insights: AdsInsight[]
        count: number
      }>("/admin/ads/insights", { query })
    },
  })
}

// ───────────────────────────── Sync mutation ─────────────────────────────

export const useAdsSync = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: {
      platform_id: string
      account_id?: string
      include_ads?: boolean
      include_insights?: boolean
      include_breakdowns?: boolean
      window_days?: number
    }) => {
      return sdk.client.fetch<{
        platform: AdsPlatformKind
        result: SyncResult | null
        hint?: string
      }>("/admin/ads/sync", { method: "POST", body })
    },
    onSuccess: () => {
      // Bust every list — the sync wrote new rows across the board.
      qc.invalidateQueries({ queryKey: adsKeys.all })
    },
  })
}
