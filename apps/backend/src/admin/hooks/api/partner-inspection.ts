/**
 * Read-only hooks for the partner inspection mirror (#843, approach #2).
 *
 * These hit the admin read-proxy routes (`/admin/partners/:id/{orders,
 * onboarding-profile}`), which run the partner portal's own scoping helpers
 * against a synthesized partner context — so what renders here is what the
 * partner sees. There are deliberately no mutation hooks in this file.
 */
import { FetchError } from "@medusajs/js-sdk"
import { QueryKey, UseQueryOptions, useQuery } from "@tanstack/react-query"
import { sdk } from "../../lib/config"
import { queryKeysFactory } from "../../lib/query-key-factory"

export type PartnerOrderKind = "retail" | "design" | "inventory" | "all"

export interface PartnerInspectionOrder {
  id: string
  display_id?: number
  custom_display_id?: string | null
  status?: string
  payment_status?: string
  fulfillment_status?: string
  total?: number
  currency_code?: string
  email?: string | null
  created_at?: string
  customer?: { id: string; email?: string; first_name?: string; last_name?: string } | null
  unified_order_status?: { partner_status?: string | null } | null
}

export interface PartnerInspectionOrdersResponse {
  orders: PartnerInspectionOrder[]
  count: number
  offset: number
  limit: number
}

export interface PartnerOnboardingProfile {
  id: string
  partner_id: string
  created_at?: string
  updated_at?: string
  [key: string]: unknown
}

const PARTNER_INSPECTION_QUERY_KEY = "partner_inspection" as const
export const partnerInspectionQueryKeys = queryKeysFactory(
  PARTNER_INSPECTION_QUERY_KEY
)

export const usePartnerInspectionOrders = (
  partnerId: string,
  query?: { kind?: PartnerOrderKind; limit?: number; offset?: number; order?: string },
  options?: Omit<
    UseQueryOptions<
      PartnerInspectionOrdersResponse,
      FetchError,
      PartnerInspectionOrdersResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<PartnerInspectionOrdersResponse>(
        `/admin/partners/${partnerId}/orders`,
        { method: "GET", query }
      ),
    queryKey: partnerInspectionQueryKeys.detail(partnerId, { orders: query }),
    enabled: !!partnerId,
    ...options,
  })

  return {
    orders: data?.orders || [],
    count: data?.count || 0,
    ...rest,
  }
}

export const usePartnerOnboardingProfile = (
  partnerId: string,
  options?: Omit<
    UseQueryOptions<
      { onboarding_profile: PartnerOnboardingProfile | null },
      FetchError,
      { onboarding_profile: PartnerOnboardingProfile | null },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<{ onboarding_profile: PartnerOnboardingProfile | null }>(
        `/admin/partners/${partnerId}/onboarding-profile`,
        { method: "GET" }
      ),
    queryKey: partnerInspectionQueryKeys.detail(partnerId, { onboarding: true }),
    enabled: !!partnerId,
    ...options,
  })

  return {
    onboardingProfile: data?.onboarding_profile ?? null,
    ...rest,
  }
}
