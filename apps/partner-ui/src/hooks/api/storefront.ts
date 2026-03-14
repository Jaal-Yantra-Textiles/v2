import { FetchError } from "@medusajs/js-sdk"
import {
  QueryKey,
  UseQueryOptions,
  useMutation,
  useQuery,
} from "@tanstack/react-query"
import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory } from "../../lib/query-key-factory"

const STOREFRONT_QUERY_KEY = "partner_storefront" as const
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
  options?: Omit<
    UseQueryOptions<StorefrontStatus, FetchError, StorefrontStatus, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<StorefrontStatus>("/partners/storefront", {
        method: "GET",
      }),
    queryKey: storefrontQueryKeys.detail("me"),
    ...options,
  })
  return { data, ...rest }
}

export const useProvisionStorefront = () => {
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch<ProvisionResponse>("/partners/storefront/provision", {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: storefrontQueryKeys.detail("me"),
      })
    },
  })
}

export const useRedeployStorefront = () => {
  return useMutation({
    mutationFn: (input?: { update_env?: boolean; ref?: string }) =>
      sdk.client.fetch<RedeployResponse>("/partners/storefront/redeploy", {
        method: "POST",
        body: input || {},
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: storefrontQueryKeys.detail("me"),
      })
    },
  })
}
