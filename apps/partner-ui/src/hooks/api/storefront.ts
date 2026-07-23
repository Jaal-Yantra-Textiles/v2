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

const DOMAIN_QUERY_KEY = "partner_storefront_domain" as const
export const domainQueryKeys = queryKeysFactory(DOMAIN_QUERY_KEY)

/**
 * The storefront status card and the custom-domain card read from two separate
 * queries but both surface the partner's domain/project state — any provision,
 * redeploy, domain add/verify/remove, or storefront removal changes BOTH. Always
 * invalidate the pair so neither card shows stale data after a mutation.
 */
const invalidateStorefrontQueries = () => {
  queryClient.invalidateQueries({ queryKey: storefrontQueryKeys.detail("me") })
  queryClient.invalidateQueries({ queryKey: domainQueryKeys.detail("me") })
}

export type HostingProvider = "vercel" | "cloudflare" | "render" | "netlify"

export interface StorefrontStatus {
  provisioned: boolean
  message?: string
  /** Which hosting provider the storefront lives on (#884). */
  provider?: HostingProvider
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
      invalidateStorefrontQueries()
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
      invalidateStorefrontQueries()
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
  verification?: Array<{ type: string; domain: string; value: string }> | null
  dns_records?: DnsRecord[]
}

export interface AddDomainResponse {
  domain: string
  verified: boolean
  verification?: Array<{ type: string; domain: string; value: string }> | null
  misconfigured: boolean
  configured_by: string | null
  dns_records?: DnsRecord[]
  /** Provider attach/heal error (e.g. Cloudflare rejected the hostname). */
  error?: string | null
}

export interface RemoveDomainResponse {
  message: string
  /** Provider hosts that couldn't be fully torn down (still resolving). */
  warnings?: string[]
}

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
      invalidateStorefrontQueries()
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
      invalidateStorefrontQueries()
    },
  })
}

export const useRemoveStorefrontDomain = () => {
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch<RemoveDomainResponse>("/partners/storefront/domain", {
        method: "DELETE",
      }),
    onSuccess: () => {
      invalidateStorefrontQueries()
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
      invalidateStorefrontQueries()
    },
  })
}
