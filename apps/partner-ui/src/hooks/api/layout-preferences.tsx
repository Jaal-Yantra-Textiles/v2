import { FetchError } from "@medusajs/js-sdk"
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
} from "@tanstack/react-query"

import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory } from "../../lib/query-key-factory"

/**
 * Partner LayoutComposer persistence (#338).
 *
 * The real client for the partner-scoped layout-configuration API
 * (`/partners/layouts/:zone/configuration`). This is the partner-ui counterpart
 * of the composer's `use-layout-preference` hook — but where investor-ui stubbed
 * persistence to a no-op, here it actually reads/writes the backend so a
 * partner's sidebar/page customizations survive reloads.
 *
 * Data contract mirrors the composer's `LayoutPreference`.
 */

// Per-widget placement/visibility override (matches WidgetPreference).
export type WidgetPreference = {
  hidden?: boolean
  section?: string
  order?: number
}

export type LayoutPreference = {
  widgets: Record<string, WidgetPreference>
}

type LayoutConfigurationRow = {
  id: string
  partner_id: string
  zone: string
  is_default: boolean
  configuration: LayoutPreference
} | null

export type LayoutConfigurationResponse = {
  personal_configuration: LayoutConfigurationRow
  default_configuration: LayoutConfigurationRow
  active_scope: "personal" | "default"
}

const LAYOUTS_QUERY_KEY = "partner-layouts" as const
export const layoutsQueryKeys = queryKeysFactory(LAYOUTS_QUERY_KEY)

/** The main sidebar's layout zone. Widget ids in this zone are nav `to` paths. */
export const SIDEBAR_ZONE = "sidebar.main"

/** The home dashboard's layout zone. Widget ids are stable section keys. */
export const HOME_ZONE = "home"

/**
 * Top-level nav routes tagged as "commerce" — hidden by default for the
 * designer persona so their workspace opens on design/production, not the full
 * store surface. Revealed on demand via the sidebar "Show commerce tools"
 * toggle (which writes an explicit `hidden:false` override that wins over this
 * persona default). Widget ids are the routes' `to` paths.
 */
export const DESIGNER_COMMERCE_ROUTE_IDS = [
  "/products",
  "/customers",
  "/content",
] as const

/**
 * Persona layout presets — the "pre-saved layout" each workspace type bootstraps
 * from before the partner has any personal config. Same `{widgets}` shape as a
 * saved LayoutPreference, so the apply order is uniform:
 *   personal override  →  persona preset  →  natural (source) order/visible.
 *
 * These are the client-side seed today; because they share the composer's data
 * contract they can be promoted to server `is_default` rows per persona later
 * (bootstrapping without a code change). Keep ids as nav `to` paths.
 */
export type SidebarPreset = LayoutPreference["widgets"]

export const SIDEBAR_PERSONA_PRESETS: Record<string, SidebarPreset> = {
  // Designer opens design-first with the commerce surface collapsed.
  designer: {
    "/designs": { order: 0 },
    "/orders": { order: 1 },
    "/payment-submissions": { order: 2 },
    "/products": { hidden: true },
    "/customers": { hidden: true },
    "/content": { hidden: true },
  },
  // Seller / manufacturer / individual already get a curated route SET from
  // useCoreRoutes, so their presets are empty (natural order, nothing hidden).
  seller: {},
  manufacturer: {},
  individual: {},
}

/** The preset for a workspace type (empty when unknown/legacy). */
export const getSidebarPreset = (workspaceType?: string): SidebarPreset =>
  (workspaceType && SIDEBAR_PERSONA_PRESETS[workspaceType]) || {}

export const usePartnerLayoutConfiguration = (
  zone: string,
  options?: Omit<
    UseQueryOptions<
      LayoutConfigurationResponse,
      FetchError,
      LayoutConfigurationResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: layoutsQueryKeys.detail(zone),
    queryFn: () =>
      sdk.client.fetch<LayoutConfigurationResponse>(
        `/partners/layouts/${encodeURIComponent(zone)}/configuration`,
        { method: "GET" }
      ),
    ...options,
  })

  return { ...data, ...rest }
}

type SetLayoutConfigurationBody = {
  is_default?: boolean
  configuration: LayoutPreference
}

export const useSetPartnerLayoutConfiguration = (
  zone: string,
  options?: UseMutationOptions<
    { layout_configuration: LayoutConfigurationRow },
    FetchError,
    SetLayoutConfigurationBody
  >
) => {
  return useMutation({
    // Spread caller options FIRST so our wrapped onSuccess below always wins —
    // otherwise a caller-supplied onSuccess (e.g. the customizer's toast+close)
    // would clobber the cache invalidation and the sidebar would keep rendering
    // the stale config (looked like "saves don't persist").
    ...options,
    mutationFn: (body: SetLayoutConfigurationBody) =>
      sdk.client.fetch<{ layout_configuration: LayoutConfigurationRow }>(
        `/partners/layouts/${encodeURIComponent(zone)}/configuration`,
        { method: "POST", body }
      ),
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({
        queryKey: layoutsQueryKeys.detail(zone),
      })
      await options?.onSuccess?.(data, variables, context)
    },
  })
}

export const useResetPartnerLayoutConfiguration = (
  zone: string,
  options?: UseMutationOptions<{ deleted: boolean }, FetchError, void>
) => {
  return useMutation({
    // See useSetPartnerLayoutConfiguration: caller options first so the
    // invalidation in our onSuccess isn't clobbered by a caller onSuccess.
    ...options,
    mutationFn: () =>
      sdk.client.fetch<{ deleted: boolean }>(
        `/partners/layouts/${encodeURIComponent(zone)}/configuration`,
        { method: "DELETE" }
      ),
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({
        queryKey: layoutsQueryKeys.detail(zone),
      })
      await options?.onSuccess?.(data, variables, context)
    },
  })
}
