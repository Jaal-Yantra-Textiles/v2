import { FetchError } from "@medusajs/js-sdk"
import { useQuery, useMutation, useQueryClient, UseQueryOptions, QueryKey } from "@tanstack/react-query"
import { sdk } from "../../lib/config"
import { queryKeysFactory } from "../../lib/query-key-factory"
import { partnersQueryKeys } from "./partners-admin"

const STOREFRONT_QUERY_KEY = "admin_partner_storefront" as const
export const storefrontQueryKeys = queryKeysFactory(STOREFRONT_QUERY_KEY)

export interface StorefrontStatus {
  provisioned: boolean
  message?: string
  project?: {
    id: string
    name: string
  } | null
  domain?: string | null
  storefront_url?: string | null
  provisioned_at?: string | null
  latest_deployment?: {
    id: string
    url: string
    status: string
    created_at: number
  } | null
  error?: string
}

export interface ProvisionResponse {
  message: string
  project: { id: string; name: string }
  domain: { name: string; verified: boolean } | null
  deployment: { id: string; url: string; status: string }
  storefront_url: string
}

export interface RedeployResponse {
  message: string
  deployment: { id: string; url: string; status: string }
}

export const useStorefrontStatus = (
  partnerId: string,
  options?: Omit<
    UseQueryOptions<StorefrontStatus, FetchError, StorefrontStatus, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<StorefrontStatus>(
        `/admin/partners/${partnerId}/storefront`,
        { method: "GET" }
      ),
    queryKey: storefrontQueryKeys.detail(partnerId),
    enabled: !!partnerId,
    ...options,
  })
  return { data, ...rest }
}

export const useProvisionStorefront = (partnerId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch<ProvisionResponse>(
        `/admin/partners/${partnerId}/storefront/provision`,
        { method: "POST" }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: storefrontQueryKeys.detail(partnerId) })
      queryClient.invalidateQueries({ queryKey: partnersQueryKeys.detail(partnerId) })
    },
  })
}

export const useRedeployStorefront = (partnerId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input?: { update_env?: boolean; ref?: string }) =>
      sdk.client.fetch<RedeployResponse>(
        `/admin/partners/${partnerId}/storefront/redeploy`,
        { method: "POST", body: input || {} }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: storefrontQueryKeys.detail(partnerId) })
    },
  })
}
