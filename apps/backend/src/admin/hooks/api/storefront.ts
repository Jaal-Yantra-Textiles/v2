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

// --- Admin custom domain hooks (mirror of /partners/storefront/domain) ---

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

const DOMAIN_QUERY_KEY = "admin_partner_storefront_domain" as const
export const domainQueryKeys = queryKeysFactory(DOMAIN_QUERY_KEY)

export const useStorefrontDomain = (
  partnerId: string,
  options?: Omit<
    UseQueryOptions<DomainStatus, FetchError, DomainStatus, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<DomainStatus>(
        `/admin/partners/${partnerId}/storefront/domain`,
        { method: "GET" }
      ),
    queryKey: domainQueryKeys.detail(partnerId),
    enabled: !!partnerId,
    ...options,
  })
  return { data, ...rest }
}

export const useAddStorefrontDomain = (partnerId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { domain: string }) =>
      sdk.client.fetch<AddDomainResponse>(
        `/admin/partners/${partnerId}/storefront/domain`,
        { method: "POST", body: input }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: domainQueryKeys.detail(partnerId) })
      queryClient.invalidateQueries({ queryKey: storefrontQueryKeys.detail(partnerId) })
      queryClient.invalidateQueries({ queryKey: partnersQueryKeys.detail(partnerId) })
    },
  })
}

export const useVerifyStorefrontDomain = (partnerId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch<AddDomainResponse>(
        `/admin/partners/${partnerId}/storefront/domain/verify`,
        { method: "POST" }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: domainQueryKeys.detail(partnerId) })
      queryClient.invalidateQueries({ queryKey: storefrontQueryKeys.detail(partnerId) })
    },
  })
}

export const useRemoveStorefrontDomain = (partnerId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch<RemoveDomainResponse>(
        `/admin/partners/${partnerId}/storefront/domain`,
        { method: "DELETE" }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: domainQueryKeys.detail(partnerId) })
      queryClient.invalidateQueries({ queryKey: storefrontQueryKeys.detail(partnerId) })
      queryClient.invalidateQueries({ queryKey: partnersQueryKeys.detail(partnerId) })
    },
  })
}
