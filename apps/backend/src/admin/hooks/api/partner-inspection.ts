/**
 * Read-only hooks for the partner inspection mirror (#843, approach #2).
 *
 * These hit the admin read-proxy routes (`/admin/partners/:id/{orders, designs,
 * production-runs, onboarding-profile}`), which run the partner portal's own
 * scoping helpers and listing workflows against a synthesized partner context —
 * so what renders here is what the partner sees. There are deliberately no
 * mutation hooks in this file.
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

export interface PartnerInspectionDesign {
  id: string
  name?: string
  status?: string
  is_owner?: boolean
  created_at?: string
  partner_info?: {
    partner_status?: string
    partner_phase?: string | null
    partner_started_at?: string | null
    partner_finished_at?: string | null
    partner_completed_at?: string | null
    workflow_tasks_count?: number
  }
}

export type PartnerDesignBucket =
  | "all"
  | "incoming"
  | "in_progress"
  | "completed"
  | "yours"

export interface PartnerInspectionDesignsResponse {
  designs: PartnerInspectionDesign[]
  count: number
  /** Per-bucket totals, counted over the whole q+status set — see #6. */
  facets?: Record<PartnerDesignBucket, number>
  offset: number
  limit: number
}

export const usePartnerInspectionDesigns = (
  partnerId: string,
  query?: {
    bucket?: PartnerDesignBucket
    status?: string
    q?: string
    limit?: number
    offset?: number
  },
  options?: Omit<
    UseQueryOptions<
      PartnerInspectionDesignsResponse,
      FetchError,
      PartnerInspectionDesignsResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<PartnerInspectionDesignsResponse>(
        `/admin/partners/${partnerId}/designs`,
        { method: "GET", query }
      ),
    queryKey: partnerInspectionQueryKeys.detail(partnerId, { designs: query }),
    enabled: !!partnerId,
    ...options,
  })

  return {
    designs: data?.designs || [],
    count: data?.count || 0,
    facets: data?.facets,
    ...rest,
  }
}

export interface PartnerInspectionProductionRun {
  id: string
  status?: string
  run_type?: string
  role?: string
  quantity?: number
  produced_quantity?: number
  design_id?: string | null
  /** Resolved from the order↔run link (#342 D5), not the legacy `order_id` column. */
  unified_order_id?: string | null
  accepted_at?: string | null
  started_at?: string | null
  finished_at?: string | null
  completed_at?: string | null
  created_at?: string
}

export interface PartnerInspectionProductionRunsResponse {
  production_runs: PartnerInspectionProductionRun[]
  count: number
  offset: number
  limit: number
}

export const usePartnerInspectionProductionRuns = (
  partnerId: string,
  query?: {
    status?: string
    role?: string
    run_type?: "production" | "sample"
    design_id?: string
    limit?: number
    offset?: number
  },
  options?: Omit<
    UseQueryOptions<
      PartnerInspectionProductionRunsResponse,
      FetchError,
      PartnerInspectionProductionRunsResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<PartnerInspectionProductionRunsResponse>(
        `/admin/partners/${partnerId}/production-runs`,
        { method: "GET", query }
      ),
    queryKey: partnerInspectionQueryKeys.detail(partnerId, { runs: query }),
    enabled: !!partnerId,
    ...options,
  })

  return {
    productionRuns: data?.production_runs || [],
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
