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

export interface RemoveStorefrontResponse {
  message: string
  results: Record<string, { action: string; error?: string; reason?: string }>
}

// --- Custom domain hooks ---

export type DnsRecord = {
  type: string
  host: string
  value: string
}

export interface DomainStatus {
  configured: boolean
  domain?: string | null
  verified?: boolean
  misconfigured?: boolean
  configured_by?: string | null
  dns_records?: DnsRecord[]
}

export interface AddDomainResponse {
  domain: string
  verified: boolean
  verification?: Array<{ type: string; domain: string; value: string }> | null
  misconfigured: boolean
  configured_by: string | null
  dns_records?: DnsRecord[]
}

const DOMAIN_QUERY_KEY = "partner_storefront_domain" as const
export const domainQueryKeys = queryKeysFactory(DOMAIN_QUERY_KEY)

export const useStorefrontDomain = (
  options?: Omit<
    UseQueryOptions<DomainStatus, FetchError, DomainStatus, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<DomainStatus>("/partners/storefront/domain", {
        method: "GET",
      }),
    queryKey: domainQueryKeys.detail("me"),
    ...options,
  })
  return { data, ...rest }
}

export const useAddStorefrontDomain = () => {
  return useMutation({
    mutationFn: (input: { domain: string }) =>
      sdk.client.fetch<AddDomainResponse>("/partners/storefront/domain", {
        method: "POST",
        body: input,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: domainQueryKeys.detail("me"),
      })
    },
  })
}

export const useVerifyStorefrontDomain = () => {
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch<AddDomainResponse>(
        "/partners/storefront/domain/verify",
        { method: "POST" }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: domainQueryKeys.detail("me"),
      })
    },
  })
}

export const useRemoveStorefrontDomain = () => {
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch<{ message: string }>("/partners/storefront/domain", {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: domainQueryKeys.detail("me"),
      })
    },
  })
}

export const useRemoveStorefront = () => {
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch<RemoveStorefrontResponse>("/partners/storefront", {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: storefrontQueryKeys.detail("me"),
      })
    },
  })
}
