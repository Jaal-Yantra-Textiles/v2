/**
 * Read-only hooks for the partner inspection mirror (#843, approach #2).
 *
 * These hit the admin read-proxy routes (`/admin/partners/:id/{orders, designs,
 * production-runs, products, inventory-items, inventory-orders,
 * onboarding-profile}`), which run the partner portal's own
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

export interface PartnerInspectionProduct {
  id: string
  title?: string
  handle?: string
  status?: string
  thumbnail?: string | null
  created_at?: string
  collection?: { id: string; title?: string } | null
  variants?: { id: string; title?: string }[]
  images?: { id: string; url?: string }[]
}

export interface PartnerInspectionProductsResponse {
  products: PartnerInspectionProduct[]
  count: number
  offset: number
  limit: number
  partner_id: string
  /** Which of the partner's stores the catalog was read from; null if they have none. */
  store_id: string | null
}

export const usePartnerInspectionProducts = (
  partnerId: string,
  query?: { store_id?: string },
  options?: Omit<
    UseQueryOptions<
      PartnerInspectionProductsResponse,
      FetchError,
      PartnerInspectionProductsResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<PartnerInspectionProductsResponse>(
        `/admin/partners/${partnerId}/products`,
        { method: "GET", query }
      ),
    queryKey: partnerInspectionQueryKeys.detail(partnerId, { products: query }),
    enabled: !!partnerId,
    ...options,
  })

  return {
    products: data?.products || [],
    count: data?.count || 0,
    storeId: data?.store_id ?? null,
    ...rest,
  }
}

export interface PartnerInspectionInventoryOrder {
  id: string
  status?: string
  quantity?: number
  total_price?: number
  order_date?: string
  expected_delivery_date?: string
  is_sample?: boolean
  order_lines_count?: number
  stock_location?: string
  partner_info?: {
    assigned_partner_id?: string
    /** Derived from the partner_assignment TASKS, not from metadata. */
    partner_status?: string
    partner_started_at?: string | null
    partner_completed_at?: string | null
    workflow_tasks_count?: number
  }
  created_at?: string
}

export interface PartnerInspectionInventoryOrdersResponse {
  inventory_orders: PartnerInspectionInventoryOrder[]
  count: number
  offset: number
  limit: number
}

export const usePartnerInspectionInventoryOrders = (
  partnerId: string,
  query?: { status?: string; q?: string; limit?: number; offset?: number },
  options?: Omit<
    UseQueryOptions<
      PartnerInspectionInventoryOrdersResponse,
      FetchError,
      PartnerInspectionInventoryOrdersResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<PartnerInspectionInventoryOrdersResponse>(
        `/admin/partners/${partnerId}/inventory-orders`,
        { method: "GET", query }
      ),
    queryKey: partnerInspectionQueryKeys.detail(partnerId, {
      inventoryOrders: query,
    }),
    enabled: !!partnerId,
    ...options,
  })

  return {
    inventoryOrders: data?.inventory_orders || [],
    count: data?.count || 0,
    ...rest,
  }
}

export interface PartnerInspectionInventoryItem {
  id: string
  sku?: string
  title?: string
  /** Aggregated over the partner's location only — see the workflow. */
  stocked_quantity?: number
  reserved_quantity?: number
  incoming_quantity?: number
  location_levels?: { id: string; location_id: string }[]
}

export interface PartnerInspectionInventoryItemsResponse {
  inventory_items: PartnerInspectionInventoryItem[]
  count: number
  offset: number
  limit: number
}

export const usePartnerInspectionInventoryItems = (
  partnerId: string,
  query?: { q?: string; limit?: number; offset?: number },
  options?: Omit<
    UseQueryOptions<
      PartnerInspectionInventoryItemsResponse,
      FetchError,
      PartnerInspectionInventoryItemsResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<PartnerInspectionInventoryItemsResponse>(
        `/admin/partners/${partnerId}/inventory-items`,
        { method: "GET", query }
      ),
    queryKey: partnerInspectionQueryKeys.detail(partnerId, {
      inventoryItems: query,
    }),
    enabled: !!partnerId,
    ...options,
  })

  return {
    inventoryItems: data?.inventory_items || [],
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

/**
 * The storefront surface (#843 slice 5) reads three things: hosting status,
 * the website + theme, and the pages. Status comes from the route that already
 * existed for provisioning; the other two are the mirror proper.
 */
export interface PartnerInspectionStorefrontStatus {
  provisioned: boolean
  provider: string
  message?: string
  project?: { id: string | null; name: string | null }
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
  vercel_configured?: boolean
  cloudflare_configured?: boolean
  /** Provider 404'd on a project we still reference. Reported, never repaired here. */
  stale_project?: boolean
}

export const usePartnerInspectionStorefront = (
  partnerId: string,
  options?: Omit<
    UseQueryOptions<
      PartnerInspectionStorefrontStatus,
      FetchError,
      PartnerInspectionStorefrontStatus,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<PartnerInspectionStorefrontStatus>(
        `/admin/partners/${partnerId}/storefront`,
        { method: "GET" }
      ),
    queryKey: partnerInspectionQueryKeys.detail(partnerId, {
      storefront: true,
    }),
    enabled: !!partnerId,
    ...options,
  })

  // NOT `status` — react-query puts its own `status` in `rest`, and spreading
  // it last would silently overwrite ours with "success".
  return { storefrontStatus: data ?? null, ...rest }
}

export interface PartnerInspectionWebsiteResponse {
  website: {
    id: string
    name?: string
    domain?: string
    status?: string
    theme?: Record<string, any> | null
    metadata?: Record<string, any> | null
  } | null
  theme: Record<string, any> | null
  /** The partner theme editor's own iframe URL (`?theme_editor=true`). */
  preview_url: string | null
  reason?: "not_provisioned" | "no_website"
  message?: string
  resolved_by?: "website_id" | "domain" | null
}

export const usePartnerInspectionWebsite = (
  partnerId: string,
  options?: Omit<
    UseQueryOptions<
      PartnerInspectionWebsiteResponse,
      FetchError,
      PartnerInspectionWebsiteResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<PartnerInspectionWebsiteResponse>(
        `/admin/partners/${partnerId}/storefront/website`,
        { method: "GET" }
      ),
    queryKey: partnerInspectionQueryKeys.detail(partnerId, { website: true }),
    enabled: !!partnerId,
    ...options,
  })

  return {
    website: data?.website ?? null,
    theme: data?.theme ?? null,
    previewUrl: data?.preview_url ?? null,
    reason: data?.reason,
    ...rest,
  }
}

export interface PartnerInspectionPage {
  id: string
  title?: string
  slug?: string
  status?: string
  page_type?: string
  updated_at?: string
}

export interface PartnerInspectionPagesResponse {
  pages: PartnerInspectionPage[]
  count: number
  offset: number
  limit: number
  hasMore: boolean
  website_id: string | null
  reason?: "not_provisioned" | "no_website"
}

export const usePartnerInspectionPages = (
  partnerId: string,
  query?: { q?: string; status?: string; page_type?: string; limit?: number },
  options?: Omit<
    UseQueryOptions<
      PartnerInspectionPagesResponse,
      FetchError,
      PartnerInspectionPagesResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<PartnerInspectionPagesResponse>(
        `/admin/partners/${partnerId}/storefront/pages`,
        { method: "GET", query }
      ),
    queryKey: partnerInspectionQueryKeys.detail(partnerId, { pages: query }),
    enabled: !!partnerId,
    ...options,
  })

  return {
    pages: data?.pages || [],
    count: data?.count || 0,
    websiteId: data?.website_id ?? null,
    ...rest,
  }
}
