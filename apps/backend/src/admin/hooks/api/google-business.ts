import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../../lib/config"

export type GoogleService = "merchant" | "ads" | "search-console" | "business-profile"

export type AccessibleResource = {
  resource_id: string
  resource_label: string
  metadata: Record<string, any>
}

export type GoogleBinding = {
  id: string
  platform_id: string
  service: GoogleService
  resource_id: string
  resource_label: string | null
  status: "active" | "paused" | "error" | "pending"
  last_synced_at: string | null
  last_error: string | null
  settings: Record<string, any> | null
  metadata: Record<string, any> | null
  created_at: string
  updated_at: string
}

export type GoogleInitOauthResponse = {
  location: string
  state: string
}

export type GoogleRefreshResponse = {
  platform_id: string
  access_token: string
  expires_at: string | null
  refreshed: boolean
}

export type GoogleAdsCustomer = {
  id: string
  customer_id: string
  resource_name: string | null
  descriptive_name: string | null
  currency_code: string | null
  time_zone: string | null
  is_manager: boolean
  is_test_account: boolean
  last_synced_at: string | null
  sync_status: "synced" | "syncing" | "error" | "pending"
  sync_error: string | null
}

export type GoogleAdsCampaign = {
  id: string
  campaign_id: string
  resource_name: string | null
  name: string
  status: string
  serving_status: string | null
  advertising_channel_type: string
  bidding_strategy_type: string | null
  start_date: string | null
  end_date: string | null
  budget_amount_micros: string | number | null
  impressions: string | number
  clicks: string | number
  conversions: string | number
  cost_micros: string | number
  last_synced_at: string | null
  customer_id: string
}

export type GoogleAdsSyncResponse = {
  platform_id: string
  customers_synced: number
  campaigns_synced: number
  ad_groups_synced: number
  errors: Array<{ customer_id: string; message: string }>
}

export type GoogleAdsConversionAction = {
  resource_name: string
  conversion_action_id: string
  name: string
  type: string | null
  status: string | null
  category: string | null
  include_in_conversions_metric: boolean | null
}

const KEYS = {
  all: ["google-business"] as const,
  bindings: (platformId: string, service?: GoogleService) =>
    [...KEYS.all, "bindings", platformId, service ?? "all"] as const,
  resources: (platformId: string, service: GoogleService) =>
    [...KEYS.all, "accessible-resources", platformId, service] as const,
  adsCustomers: (platformId: string) =>
    [...KEYS.all, "ads-customers", platformId] as const,
  adsCampaigns: (platformId: string, customerId?: string) =>
    [...KEYS.all, "ads-campaigns", platformId, customerId ?? "all"] as const,
  adsConversionActions: (platformId: string, customerId: string) =>
    [...KEYS.all, "ads-conversion-actions", platformId, customerId] as const,
}

export function useInitiateGoogleConnect(platformId: string) {
  return useMutation({
    mutationFn: async (input: { services: GoogleService[]; loginHint?: string }) => {
      const response = await sdk.client.fetch<GoogleInitOauthResponse>(
        `/admin/social-platforms/${platformId}/google/oauth-init`,
        {
          method: "POST",
          body: { services: input.services, login_hint: input.loginHint },
        }
      )
      localStorage.setItem("oauth_platform_id", platformId)
      localStorage.setItem("oauth_platform_kind", "google")
      window.location.href = response.location
      return response
    },
  })
}

export function useRefreshGoogleToken(platformId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (force?: boolean) =>
      sdk.client.fetch<GoogleRefreshResponse>(
        `/admin/social-platforms/${platformId}/google/refresh-token`,
        { method: "POST", body: { force: !!force } }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["social-platforms"] })
      qc.invalidateQueries({ queryKey: KEYS.all })
    },
  })
}

export function useGoogleAccessibleResources(
  platformId: string,
  service: GoogleService | null,
  enabled = true
) {
  const query = useQuery({
    queryKey: KEYS.resources(platformId, service as GoogleService),
    queryFn: () =>
      sdk.client.fetch<{ service: GoogleService; resources: AccessibleResource[] }>(
        `/admin/social-platforms/${platformId}/google/accessible-resources/${service}`,
        { method: "GET" }
      ),
    enabled: enabled && !!service && !!platformId,
  })
  return {
    resources: query.data?.resources || [],
    ...query,
  }
}

export function useGoogleBindings(platformId: string, service?: GoogleService) {
  const query = useQuery({
    queryKey: KEYS.bindings(platformId, service),
    queryFn: () =>
      sdk.client.fetch<{ bindings: GoogleBinding[]; count: number }>(
        `/admin/social-platforms/${platformId}/google/bindings`,
        { method: "GET", query: service ? { service } : undefined }
      ),
    enabled: !!platformId,
  })
  return {
    bindings: query.data?.bindings || [],
    count: query.data?.count || 0,
    ...query,
  }
}

export function useUpsertGoogleBinding(platformId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      service: GoogleService
      resource_id: string
      resource_label?: string | null
      settings?: Record<string, any> | null
      metadata?: Record<string, any> | null
    }) =>
      sdk.client.fetch<{ binding: GoogleBinding }>(
        `/admin/social-platforms/${platformId}/google/bindings`,
        { method: "POST", body }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all })
    },
  })
}

export function useDeleteGoogleBinding(platformId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (bindingId: string) =>
      sdk.client.fetch<{ id: string; deleted: boolean }>(
        `/admin/social-platforms/${platformId}/google/bindings/${bindingId}`,
        { method: "DELETE" }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all })
    },
  })
}

export function useGoogleAdsCustomers(platformId: string, enabled = true) {
  const query = useQuery({
    queryKey: KEYS.adsCustomers(platformId),
    queryFn: () =>
      sdk.client.fetch<{ customers: GoogleAdsCustomer[]; count: number }>(
        `/admin/social-platforms/${platformId}/google/ads/customers`,
        { method: "GET" }
      ),
    enabled: enabled && !!platformId,
  })
  return {
    customers: query.data?.customers || [],
    count: query.data?.count || 0,
    ...query,
  }
}

export function useGoogleAdsCampaigns(
  platformId: string,
  customerId?: string,
  enabled = true
) {
  const query = useQuery({
    queryKey: KEYS.adsCampaigns(platformId, customerId),
    queryFn: () =>
      sdk.client.fetch<{
        campaigns: GoogleAdsCampaign[]
        count: number
        customers: GoogleAdsCustomer[]
      }>(`/admin/social-platforms/${platformId}/google/ads/campaigns`, {
        method: "GET",
        query: customerId ? { customer_id: customerId } : undefined,
      }),
    enabled: enabled && !!platformId,
  })
  return {
    campaigns: query.data?.campaigns || [],
    count: query.data?.count || 0,
    customers: query.data?.customers || [],
    ...query,
  }
}

export function useSyncGoogleAds(platformId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input?: { customer_id?: string }) =>
      sdk.client.fetch<GoogleAdsSyncResponse>(
        `/admin/social-platforms/${platformId}/google/ads/sync`,
        { method: "POST", body: input || {} }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all })
    },
  })
}

export function useGoogleAdsConversionActions(
  platformId: string,
  customerId: string | null,
  enabled = true
) {
  const query = useQuery({
    queryKey: KEYS.adsConversionActions(platformId, customerId || ""),
    queryFn: () =>
      sdk.client.fetch<{
        customer_id: string
        conversion_actions: GoogleAdsConversionAction[]
      }>(
        `/admin/social-platforms/${platformId}/google/ads/conversion-actions`,
        { method: "GET", query: { customer_id: customerId } }
      ),
    enabled: enabled && !!platformId && !!customerId,
  })
  return {
    conversionActions: query.data?.conversion_actions || [],
    ...query,
  }
}
