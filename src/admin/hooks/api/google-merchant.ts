import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../../lib/config"

export type GoogleMerchantAccount = {
  id: string
  name: string
  merchant_id: string
  client_id: string
  redirect_uri: string
  scope?: string | null
  account_email?: string | null
  is_active: boolean
  connected: boolean
  has_client_secret: boolean
  has_refresh_token: boolean
  token_expires_at?: string | null
  api_config?: Record<string, any> | null
  created_at: string
  updated_at: string
}

const KEYS = {
  all: ["google-merchant-accounts"] as const,
  list: (params: any) => [...KEYS.all, "list", params] as const,
  detail: (id: string) => [...KEYS.all, "detail", id] as const,
  productStatus: (product_id: string) => [...KEYS.all, "product-status", product_id] as const,
  syncJobs: (account_id: string) => [...KEYS.all, "sync-jobs", account_id] as const,
  syncJob: (job_id: string) => [...KEYS.all, "sync-job", job_id] as const,
}

export type GoogleMerchantSyncJob = {
  id: string
  account_id: string
  status: "pending" | "processing" | "completed" | "failed"
  total_products: number
  synced_count: number
  failed_count: number
  error_log?: any | null
  started_at?: string | null
  completed_at?: string | null
  created_at: string
  updated_at: string
}

export function useGoogleMerchantAccounts(params?: { limit?: number; offset?: number; q?: string }) {
  const query = useQuery({
    queryKey: KEYS.list(params || {}),
    queryFn: () =>
      sdk.client.fetch<{ accounts: GoogleMerchantAccount[]; count: number }>("/admin/google-merchant/accounts", {
        method: "GET",
        query: params as any,
      }),
  })
  return {
    accounts: query.data?.accounts || [],
    count: query.data?.count || 0,
    ...query,
  }
}

export function useGoogleMerchantAccount(id: string | undefined) {
  const query = useQuery({
    queryKey: KEYS.detail(id!),
    queryFn: () =>
      sdk.client.fetch<{ account: GoogleMerchantAccount }>(`/admin/google-merchant/accounts/${id}`, { method: "GET" }),
    enabled: !!id,
  })
  return { account: query.data?.account, ...query }
}

export function useCreateGoogleMerchantAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Record<string, any>) =>
      sdk.client.fetch<{ account: GoogleMerchantAccount }>("/admin/google-merchant/accounts", {
        method: "POST",
        body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.all }),
  })
}

export function useUpdateGoogleMerchantAccount(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Record<string, any>) =>
      sdk.client.fetch<{ account: GoogleMerchantAccount }>(`/admin/google-merchant/accounts/${id}`, {
        method: "POST",
        body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.detail(id) })
      qc.invalidateQueries({ queryKey: KEYS.all })
    },
  })
}

export function useDeleteGoogleMerchantAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      sdk.client.fetch(`/admin/google-merchant/accounts/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.all }),
  })
}

export function useInitiateGoogleMerchantOAuth() {
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await sdk.client.fetch<{ location: string; state: string }>(
        `/admin/google-merchant/accounts/${id}/oauth-init`,
        { method: "GET" }
      )
      localStorage.setItem("google_merchant_oauth_account_id", id)
      localStorage.setItem("google_merchant_oauth_state", response.state)
      window.location.href = response.location
      return response
    },
  })
}

export function useSyncProductToGoogleMerchant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      account_id,
      product_id,
      ...rest
    }: {
      account_id: string
      product_id: string
      content_language?: string
      feed_label?: string
      currency_code?: string
      landing_url_base?: string
    }) =>
      sdk.client.fetch<{ success: boolean; google_product_id?: string; google_product_name?: string }>(
        `/admin/google-merchant/accounts/${account_id}/sync-product`,
        { method: "POST", body: { product_id, ...rest } }
      ),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: KEYS.productStatus(vars.product_id) })
    },
  })
}

export type ProductAccountSyncStatus = {
  account_id: string
  account_name: string
  merchant_id: string
  account_email?: string | null
  connected: boolean
  sync_status: "not_synced" | "pending" | "synced" | "failed" | string
  google_product_id?: string | null
  google_product_name?: string | null
  last_synced_at?: string | null
  sync_error?: string | null
}

export function useProductGoogleMerchantStatus(product_id: string | undefined) {
  const query = useQuery({
    queryKey: KEYS.productStatus(product_id!),
    queryFn: () =>
      sdk.client.fetch<{ product_id: string; links: ProductAccountSyncStatus[] }>(
        "/admin/google-merchant/product-sync-status",
        {
          method: "GET",
          query: { product_id: product_id as string },
        }
      ),
    enabled: !!product_id,
  })
  return { ...query, links: query.data?.links || [] }
}

export type GoogleMerchantDataSource = {
  name: string
  dataSourceId: string
  displayName: string
  input?: string
  primaryProductDataSource?: {
    feedLabel?: string
    contentLanguage?: string
    channel?: string
  }
}

export function useGoogleMerchantDataSources(account_id: string | undefined) {
  const query = useQuery({
    queryKey: [...KEYS.detail(account_id!), "data-sources"],
    queryFn: () =>
      sdk.client.fetch<{ data_sources: GoogleMerchantDataSource[]; selected: string | null }>(
        `/admin/google-merchant/accounts/${account_id}/data-sources`,
        { method: "GET" }
      ),
    enabled: !!account_id,
  })
  return {
    dataSources: query.data?.data_sources || [],
    selected: query.data?.selected || null,
    ...query,
  }
}

export function useGoogleMerchantDataSourceAction(account_id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { action: "detect" | "create" | "select"; data_source_name?: string; display_name?: string }) =>
      sdk.client.fetch<{ selected: string; detected?: any; created?: any }>(
        `/admin/google-merchant/accounts/${account_id}/data-sources`,
        { method: "POST", body }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.detail(account_id) })
    },
  })
}

export type ImportExistingResult = {
  account_id: string
  google_total: number
  matched: number
  linked: number
  skipped_existing_link: number
  unmatched: Array<{ offer_id: string; google_name: string }>
}

export function useImportExistingGoogleProducts(account_id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body?: { dry_run?: boolean }) =>
      sdk.client.fetch<ImportExistingResult>(`/admin/google-merchant/accounts/${account_id}/import`, {
        method: "POST",
        body: body || {},
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.detail(account_id) })
    },
  })
}

export function useBulkSyncGoogleMerchant(account_id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body?: { product_ids?: string[]; content_language?: string; feed_label?: string; currency_code?: string; landing_url_base?: string }) =>
      sdk.client.fetch<{ job: GoogleMerchantSyncJob }>(`/admin/google-merchant/accounts/${account_id}/sync-all`, {
        method: "POST",
        body: body || {},
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.syncJobs(account_id) }),
  })
}

export function useGoogleMerchantSyncJobs(account_id: string | undefined, opts?: { refetchIntervalMs?: number }) {
  const query = useQuery({
    queryKey: KEYS.syncJobs(account_id!),
    queryFn: () =>
      sdk.client.fetch<{ jobs: GoogleMerchantSyncJob[]; count: number }>(
        `/admin/google-merchant/accounts/${account_id}/sync-jobs`,
        { method: "GET" }
      ),
    enabled: !!account_id,
    refetchInterval: opts?.refetchIntervalMs,
  })
  return { jobs: query.data?.jobs || [], count: query.data?.count || 0, ...query }
}

export function useUnsyncProductFromGoogleMerchant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ account_id, product_id }: { account_id: string; product_id: string }) =>
      sdk.client.fetch(`/admin/google-merchant/accounts/${account_id}/products/${product_id}`, {
        method: "DELETE",
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: KEYS.productStatus(vars.product_id) })
    },
  })
}
