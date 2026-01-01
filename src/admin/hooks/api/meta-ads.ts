import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../../lib/config"

// ============ Types ============

export type LeadStatus = "new" | "contacted" | "qualified" | "unqualified" | "converted" | "lost" | "archived"

export interface Lead {
  id: string
  meta_lead_id: string
  
  // Contact info
  email?: string
  phone?: string
  full_name?: string
  first_name?: string
  last_name?: string
  company_name?: string
  job_title?: string
  city?: string
  state?: string
  country?: string
  zip_code?: string
  
  // Form data
  field_data?: Record<string, any>
  
  // Source tracking
  ad_id?: string
  ad_name?: string
  adset_id?: string
  adset_name?: string
  campaign_id?: string
  campaign_name?: string
  form_id?: string
  form_name?: string
  page_id?: string
  page_name?: string
  source_platform?: string
  
  // Timestamps
  created_time: string
  created_at: string
  updated_at: string
  
  // Status & workflow
  status: LeadStatus
  notes?: string
  assigned_to?: string
  assigned_at?: string
  contacted_at?: string
  qualified_at?: string
  converted_at?: string
  
  // Value
  estimated_value?: number
  actual_value?: number
  
  // External integration
  person_id?: string
  external_id?: string
  external_system?: string
  
  // Relationships
  platform_id?: string
  lead_form_id?: string
  
  metadata?: Record<string, any>
}

export interface AdAccount {
  id: string
  meta_account_id: string
  name: string
  currency: string
  timezone?: string
  business_name?: string
  business_id?: string
  status: "active" | "disabled" | "pending" | "error"
  account_status?: number
  amount_spent: number
  spend_cap?: number
  balance?: number
  last_synced_at?: string
  sync_status: "synced" | "syncing" | "error" | "pending"
  platform_id: string
  created_at: string
  updated_at: string
}

export interface AdSet {
  id: string
  meta_adset_id: string
  name: string
  status: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED"
  effective_status?: string
  impressions?: any
  clicks?: any
  spend?: any
  reach?: any
  leads?: any
  ctr?: number
  cpc?: number
  cpm?: number
  cost_per_lead?: number
  last_synced_at?: string
  campaign_id: string
  created_at?: string
  updated_at?: string
}

export interface Ad {
  id: string
  meta_ad_id: string
  name: string
  status: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED"
  effective_status?: string
  impressions?: any
  clicks?: any
  spend?: any
  reach?: any
  leads?: any
  conversions?: any
  ctr?: number
  cpc?: number
  cpm?: number
  cost_per_lead?: number
  last_synced_at?: string
  ad_set_id: string
  created_at?: string
  updated_at?: string
}

export interface AdCampaign {
  id: string
  meta_campaign_id: string
  name: string
  objective: string
  status: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED"
  effective_status?: string
  daily_budget?: number
  lifetime_budget?: number
  impressions: number
  clicks: number
  spend: number
  reach: number
  leads: number
  cpc?: number
  cpm?: number
  ctr?: number
  cost_per_lead?: number
  last_synced_at?: string
  ad_account_id: string
  created_at: string
  updated_at: string
}

export type MetaAdsOverviewLevel = "account" | "campaign" | "adset" | "ad"

export type MetaAdsOverviewTotals = {
  impressions: number
  reach: number
  clicks: number
  spend: number
  ctr: number
  cpc: number
  cpm: number
}

export type MetaAdsOverviewBreakdownRow = {
  key: Record<string, string>
  totals: MetaAdsOverviewTotals
  results: Record<string, number>
}

export type MetaAdsOverviewResponse = {
  scope: {
    platform_id: string
    ad_account_id: string
    level: MetaAdsOverviewLevel
    object_id?: string
    date_preset: string
    time_increment?: number
    last_synced_at?: string | null
  }
  totals: MetaAdsOverviewTotals
  results: Record<string, number>
  audience: null | {
    by_age_gender: MetaAdsOverviewBreakdownRow[]
    by_country: MetaAdsOverviewBreakdownRow[]
  }
  content: null | {
    by_publisher_platform: MetaAdsOverviewBreakdownRow[]
    by_platform_position: MetaAdsOverviewBreakdownRow[]
    by_device_platform: MetaAdsOverviewBreakdownRow[]
  }
  capabilities: {
    remote_ad_creation: {
      supported: boolean
    }
  }
  persistence?: {
    enabled: boolean
    created: number
    updated: number
    errors: number
  }
  data_source?: "db" | "meta"
}

// ============ Query Keys ============

export const metaAdsKeys = {
  all: ["meta-ads"] as const,
  
  // Leads
  leads: () => [...metaAdsKeys.all, "leads"] as const,
  leadsList: (filters: Record<string, any>) => [...metaAdsKeys.leads(), "list", filters] as const,
  leadDetail: (id: string) => [...metaAdsKeys.leads(), "detail", id] as const,
  
  // Ad Accounts
  accounts: () => [...metaAdsKeys.all, "accounts"] as const,
  accountsList: () => [...metaAdsKeys.accounts(), "list"] as const,
  accountDetail: (id: string) => [...metaAdsKeys.accounts(), "detail", id] as const,
  
  // Campaigns
  campaigns: () => [...metaAdsKeys.all, "campaigns"] as const,
  campaignsList: (filters: Record<string, any>) => [...metaAdsKeys.campaigns(), "list", filters] as const,
  campaignDetail: (id: string) => [...metaAdsKeys.campaigns(), "detail", id] as const,

  // Ad Sets
  adSets: () => [...metaAdsKeys.all, "adsets"] as const,
  adSetsList: (filters: Record<string, any>) => [...metaAdsKeys.adSets(), "list", filters] as const,
  adSetDetail: (id: string) => [...metaAdsKeys.adSets(), "detail", id] as const,

  // Ads
  ads: () => [...metaAdsKeys.all, "ads"] as const,
  adsList: (filters: Record<string, any>) => [...metaAdsKeys.ads(), "list", filters] as const,
  adDetail: (id: string) => [...metaAdsKeys.ads(), "detail", id] as const,

  // Overview
  overview: () => [...metaAdsKeys.all, "overview"] as const,
  overviewDetail: (params: Record<string, any>) => [...metaAdsKeys.overview(), "detail", params] as const,
}

// ============ Lead Hooks ============

export interface ListLeadsParams {
  status?: LeadStatus
  campaign_id?: string
  form_id?: string
  platform_id?: string
  since?: string
  until?: string
  q?: string
  limit?: number
  offset?: number
}

export const useLeads = (params?: ListLeadsParams) => {
  return useQuery({
    queryKey: metaAdsKeys.leadsList(params || {}),
    queryFn: async () => {
      const query: Record<string, string> = {}
      if (params?.status) query.status = params.status
      if (params?.campaign_id) query.campaign_id = params.campaign_id
      if (params?.form_id) query.form_id = params.form_id
      if (params?.platform_id) query.platform_id = params.platform_id
      if (params?.since) query.since = params.since
      if (params?.until) query.until = params.until
      if (params?.q) query.q = params.q
      if (params?.limit) query.limit = params.limit.toString()
      if (params?.offset) query.offset = params.offset.toString()
      
      const response = await sdk.client.fetch<{
        leads: Lead[]
        count: number
        total: number
        limit: number
        offset: number
      }>(`/admin/meta-ads/leads`, { query })
      
      return response
    },
  })
}

export interface ListAdSetsParams {
  campaign_id?: string
  ad_account_id?: string
  limit?: number
  offset?: number
}

export const useAdSets = (params?: ListAdSetsParams) => {
  return useQuery({
    queryKey: metaAdsKeys.adSetsList(params || {}),
    queryFn: async () => {
      const queryParams = new URLSearchParams()
      if (params?.campaign_id) queryParams.set("campaign_id", params.campaign_id)
      if (params?.ad_account_id) queryParams.set("ad_account_id", params.ad_account_id)
      if (params?.limit) queryParams.set("limit", params.limit.toString())
      if (params?.offset) queryParams.set("offset", params.offset.toString())

      const queryString = queryParams.toString()
      const url = queryString ? `/admin/meta-ads/adsets?${queryString}` : `/admin/meta-ads/adsets`

      const response = await sdk.client.fetch<{
        adSets: AdSet[]
        count: number
        total?: number
        limit?: number
        offset?: number
      }>(url)

      return response
    },
    enabled: Boolean(params?.campaign_id || params?.ad_account_id),
  })
}

export interface ListAdsParams {
  ad_set_id?: string
  campaign_id?: string
  ad_account_id?: string
  limit?: number
  offset?: number
}

export const useAds = (params?: ListAdsParams) => {
  return useQuery({
    queryKey: metaAdsKeys.adsList(params || {}),
    queryFn: async () => {
      const queryParams = new URLSearchParams()
      if (params?.ad_set_id) queryParams.set("ad_set_id", params.ad_set_id)
      if (params?.campaign_id) queryParams.set("campaign_id", params.campaign_id)
      if (params?.ad_account_id) queryParams.set("ad_account_id", params.ad_account_id)
      if (params?.limit) queryParams.set("limit", params.limit.toString())
      if (params?.offset) queryParams.set("offset", params.offset.toString())

      const queryString = queryParams.toString()
      const url = queryString ? `/admin/meta-ads/ads?${queryString}` : `/admin/meta-ads/ads`

      const response = await sdk.client.fetch<{
        ads: Ad[]
        count: number
        total?: number
        limit?: number
        offset?: number
      }>(url)

      return response
    },
    enabled: Boolean(params?.ad_set_id || params?.campaign_id || params?.ad_account_id),
  })
}

export const useMetaAdsOverview = (params?: {
  platform_id?: string
  ad_account_id?: string
  level?: MetaAdsOverviewLevel
  object_id?: string
  date_preset?: string
  time_increment?: number
  include_audience?: boolean
  include_content?: boolean
  persist?: boolean
  refresh?: "auto" | "force" | "never"
  max_age_minutes?: number
}) => {
  return useQuery({
    queryKey: metaAdsKeys.overviewDetail(params || {}),
    queryFn: async () => {
      const query: Record<string, string> = {}

      if (params?.platform_id) query.platform_id = params.platform_id
      if (params?.ad_account_id) query.ad_account_id = params.ad_account_id
      if (params?.level) query.level = params.level
      if (params?.object_id) query.object_id = params.object_id
      if (params?.date_preset) query.date_preset = params.date_preset
      if (typeof params?.time_increment === "number") {
        query.time_increment = String(params.time_increment)
      }
      if (typeof params?.include_audience === "boolean") {
        query.include_audience = String(params.include_audience)
      }
      if (typeof params?.include_content === "boolean") {
        query.include_content = String(params.include_content)
      }
      if (typeof params?.persist === "boolean") {
        query.persist = String(params.persist)
      }
      if (params?.refresh) {
        query.refresh = params.refresh
      }
      if (typeof params?.max_age_minutes === "number") {
        query.max_age_minutes = String(params.max_age_minutes)
      }

      return sdk.client.fetch<MetaAdsOverviewResponse>(`/admin/meta-ads/overview`, {
        query,
      })
    },
    enabled: !!params?.platform_id && !!params?.ad_account_id,
  })
}

export const useLead = (id: string, options?: { initialData?: Lead }) => {
  return useQuery({
    queryKey: metaAdsKeys.leadDetail(id),
    queryFn: async () => {
      const response = await sdk.client.fetch<{ lead: Lead }>(
        `/admin/meta-ads/leads/${id}`
      )
      return response.lead
    },
    enabled: !!id,
    initialData: options?.initialData,
  })
}

export const useUpdateLead = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async ({ id, ...data }: {
      id: string
      status?: LeadStatus
      notes?: string
      assigned_to?: string
      estimated_value?: number
      actual_value?: number
      person_id?: string
    }) => {
      const response = await sdk.client.fetch<{ lead: Lead }>(
        `/admin/meta-ads/leads/${id}`,
        { method: "PATCH", body: data }
      )
      return response.lead
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: metaAdsKeys.leadDetail(variables.id) })
      queryClient.invalidateQueries({ queryKey: metaAdsKeys.leads() })
    },
  })
}

export const useDeleteLead = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (id: string) => {
      await sdk.client.fetch(`/admin/meta-ads/leads/${id}`, { method: "DELETE" })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: metaAdsKeys.leads() })
    },
  })
}

export const useSyncLeads = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (data: {
      platform_id: string
      form_id?: string
      since?: string
    }) => {
      const response = await sdk.client.fetch<{
        message: string
        results: {
          synced: number
          skipped: number
          errors: number
          forms_processed: number
          error_messages: string[]
        }
      }>(`/admin/meta-ads/leads/sync`, { method: "POST", body: data })
      return response
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: metaAdsKeys.leads() })
    },
  })
}

// ============ Ad Account Hooks ============

export const useAdAccounts = () => {
  return useQuery({
    queryKey: metaAdsKeys.accountsList(),
    queryFn: async () => {
      const response = await sdk.client.fetch<{
        accounts: AdAccount[]
        count: number
      }>(`/admin/meta-ads/accounts`)
      return response
    },
  })
}

export const useSyncAdAccounts = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (platform_id: string) => {
      const response = await sdk.client.fetch<{
        message: string
        results: {
          created: number
          updated: number
          errors: number
        }
      }>(`/admin/meta-ads/accounts/sync`, { method: "POST", body: { platform_id } })
      return response
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: metaAdsKeys.accounts() })
    },
  })
}

// ============ Campaign Hooks ============

export interface ListCampaignsParams {
  ad_account_id?: string
  status?: string
  limit?: number
  offset?: number
}

export const useAdCampaigns = (params?: ListCampaignsParams) => {
  return useQuery({
    queryKey: metaAdsKeys.campaignsList(params || {}),
    queryFn: async () => {
      const queryParams = new URLSearchParams()
      if (params?.ad_account_id) queryParams.set("ad_account_id", params.ad_account_id)
      if (params?.status) queryParams.set("status", params.status)
      if (params?.limit) queryParams.set("limit", params.limit.toString())
      if (params?.offset) queryParams.set("offset", params.offset.toString())
      
      const queryString = queryParams.toString()
      const url = queryString ? `/admin/meta-ads/campaigns?${queryString}` : `/admin/meta-ads/campaigns`
      
      const response = await sdk.client.fetch<{
        campaigns: AdCampaign[]
        count: number
        total: number
        limit: number
        offset: number
      }>(url)
      return response
    },
  })
}

// Types for campaign totals
export interface CampaignTotals {
  spend: number
  impressions: number
  clicks: number
  leads: number
  reach: number
  conversions: number
  ctr: number
  cpc: number
  cpm: number
  cpl: number
  cpa: number
  campaign_count: number
  // Aliases for backward compatibility
  avgCTR: number
  avgCPL: number
}

// Hook to get campaign totals from API (calculated server-side)
export const useCampaignTotals = (params?: { ad_account_id?: string; status?: string }) => {
  return useQuery({
    queryKey: [...metaAdsKeys.campaigns(), "totals", params],
    queryFn: async () => {
      const queryParams = new URLSearchParams()
      if (params?.ad_account_id) queryParams.set("ad_account_id", params.ad_account_id)
      if (params?.status) queryParams.set("status", params.status)
      
      const queryString = queryParams.toString()
      const url = queryString 
        ? `/admin/meta-ads/campaigns/totals?${queryString}` 
        : `/admin/meta-ads/campaigns/totals`
      
      const response = await sdk.client.fetch<{
        totals: {
          spend: number
          impressions: number
          clicks: number
          leads: number
          reach: number
          conversions: number
          ctr: number
          cpc: number
          cpm: number
          cpl: number
          cpa: number
          campaign_count: number
        }
      }>(url)
      
      // Add aliases for backward compatibility
      return {
        ...response.totals,
        avgCTR: response.totals.ctr,
        avgCPL: response.totals.cpl,
      } as CampaignTotals
    },
  })
}

// Backward compatibility alias
export const useAllCampaignsTotals = useCampaignTotals

export const useAdCampaign = (id: string) => {
  return useQuery({
    queryKey: metaAdsKeys.campaignDetail(id),
    queryFn: async () => {
      const response = await sdk.client.fetch<{
        campaign: AdCampaign
      }>(`/admin/meta-ads/campaigns/${id}`)
      return response
    },
    enabled: !!id,
  })
}

export const useAdSet = (id: string) => {
  return useQuery({
    queryKey: metaAdsKeys.adSetDetail(id),
    queryFn: async () => {
      const response = await sdk.client.fetch<{
        adSet: any
      }>(`/admin/meta-ads/adsets/${id}`)
      return response
    },
    enabled: !!id,
  })
}

export const useAd = (id: string) => {
  return useQuery({
    queryKey: metaAdsKeys.adDetail(id),
    queryFn: async () => {
      const response = await sdk.client.fetch<{
        ad: any
      }>(`/admin/meta-ads/ads/${id}`)
      return response
    },
    enabled: !!id,
  })
}

export const useSyncCampaigns = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (data: {
      ad_account_id: string
      include_insights?: boolean
    }) => {
      const response = await sdk.client.fetch<{
        message: string
        results: {
          created: number
          updated: number
          errors: number
        }
      }>(`/admin/meta-ads/campaigns/sync`, { method: "POST", body: data })
      return response
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: metaAdsKeys.campaigns() })
    },
  })
}

// ============ Insights Hooks ============

export const useSyncInsights = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (data: {
      platform_id: string
      ad_account_id: string
      level?: "account" | "campaign" | "adset" | "ad"
      date_preset?: "last_7d" | "last_14d" | "last_30d" | "last_90d" | "maximum"
      time_increment?: string
      include_breakdowns?: boolean
    }) => {
      const response = await sdk.client.fetch<{
        message: string
        results: {
          synced: number
          updated: number
          errors: number
          error_messages: string[]
        }
      }>(`/admin/meta-ads/insights/sync`, { method: "POST", body: data })
      return response
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: metaAdsKeys.campaigns() })
      queryClient.invalidateQueries({ queryKey: metaAdsKeys.accounts() })
    },
  })
}

// ============ Status Update Hooks ============

export const useUpdateCampaignStatus = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (data: { id: string; status: "ACTIVE" | "PAUSED" }) => {
      const response = await sdk.client.fetch<{
        message: string
        campaign: AdCampaign
      }>(`/admin/meta-ads/campaigns/${data.id}/status`, { 
        method: "POST", 
        body: { status: data.status } 
      })
      return response
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: metaAdsKeys.campaigns() })
      queryClient.invalidateQueries({ queryKey: metaAdsKeys.campaignDetail(variables.id) })
    },
  })
}

export const useUpdateAdSetStatus = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (data: { id: string; status: "ACTIVE" | "PAUSED" }) => {
      const response = await sdk.client.fetch<{
        message: string
        adSet: any
      }>(`/admin/meta-ads/adsets/${data.id}/status`, { 
        method: "POST", 
        body: { status: data.status } 
      })
      return response
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: metaAdsKeys.campaigns() })
    },
  })
}

export const useUpdateAdStatus = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (data: { id: string; status: "ACTIVE" | "PAUSED" }) => {
      const response = await sdk.client.fetch<{
        message: string
        ad: any
      }>(`/admin/meta-ads/ads/${data.id}/status`, { 
        method: "POST", 
        body: { status: data.status } 
      })
      return response
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: metaAdsKeys.campaigns() })
    },
  })
}
