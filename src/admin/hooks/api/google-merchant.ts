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

export function useProductGoogleMerchantStatus(product_id: string | undefined) {
  const query = useQuery({
    queryKey: KEYS.productStatus(product_id!),
    queryFn: () =>
      sdk.client.fetch<{
        product_id: string
        links: Array<{
          account_id: string
          account_name: string
          merchant_id: string
          account_email?: string | null
          connected: boolean
        }>
      }>("/admin/google-merchant/product-sync-status", {
        method: "GET",
        query: { product_id: product_id as string },
      }),
    enabled: !!product_id,
  })
  return { ...query, links: query.data?.links || [] }
}
