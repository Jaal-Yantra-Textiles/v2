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
      const query: Record<string, string> = {}
      if (params?.ad_account_id) query.ad_account_id = params.ad_account_id
      if (params?.status) query.status = params.status
      if (params?.limit) query.limit = params.limit.toString()
      if (params?.offset) query.offset = params.offset.toString()
      
      const response = await sdk.client.fetch<{
        campaigns: AdCampaign[]
        count: number
        total: number
        limit: number
        offset: number
      }>(`/admin/meta-ads/campaigns`)
      return response
    },
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
