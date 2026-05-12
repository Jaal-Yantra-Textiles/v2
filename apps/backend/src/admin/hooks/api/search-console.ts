import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../../lib/config"

// Hooks for the per-website Search Console view at
// /admin/websites/[id]/console. The backend resolves the bound GSC
// property from the website's domain, so callers only ever pass the
// website id.

export interface ConsoleStatus {
  website: { id: string; domain: string; name: string }
  bound: boolean
  binding?: {
    binding_id: string
    platform_id: string
    resource_id: string
    matched_via: "url_prefix" | "url_prefix_www" | "sc_domain" | "sc_domain_parent"
  }
  site?: {
    id: string
    site_url: string
    permission_level: string | null
    last_synced_at: string | null
    sync_status: string
    sync_error: string | null
  } | null
  candidates: string[]
}

export type ConsoleDimension =
  | "date"
  | "query"
  | "page"
  | "country"
  | "device"

export interface ConsoleInsightRow {
  date?: string
  query?: string
  page?: string
  country?: string
  device?: string
  clicks: number
  impressions: number
  ctr: number | null
  position: number | null
}

export interface ConsoleInsightsResponse {
  rows: ConsoleInsightRow[]
  dimension: ConsoleDimension
  total: { clicks: number; impressions: number }
  bound: boolean
  synced?: boolean
  window?: { from: string; to: string }
}

export const consoleKeys = {
  all: ["search-console"] as const,
  status: (websiteId: string) =>
    [...consoleKeys.all, "status", websiteId] as const,
  insights: (websiteId: string, params: object) =>
    [...consoleKeys.all, "insights", websiteId, params] as const,
}

export const useWebsiteConsoleStatus = (websiteId: string) => {
  return useQuery({
    queryKey: consoleKeys.status(websiteId),
    enabled: !!websiteId,
    queryFn: () =>
      sdk.client.fetch<ConsoleStatus>(`/admin/websites/${websiteId}/console`),
  })
}

export const useWebsiteConsoleInsights = (
  websiteId: string,
  params: {
    dimension?: ConsoleDimension
    from?: string
    to?: string
    limit?: number
  }
) => {
  return useQuery({
    queryKey: consoleKeys.insights(websiteId, params),
    enabled: !!websiteId,
    queryFn: () => {
      const query: Record<string, string> = {}
      if (params.dimension) query.dimension = params.dimension
      if (params.from) query.from = params.from
      if (params.to) query.to = params.to
      if (params.limit) query.limit = String(params.limit)
      return sdk.client.fetch<ConsoleInsightsResponse>(
        `/admin/websites/${websiteId}/console/insights`,
        { query }
      )
    },
  })
}

export const useWebsiteConsoleSync = (websiteId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: {
      window_days?: number
      row_limit?: number
      dimensions?: Array<
        "date" | "query" | "page" | "country" | "device" | "searchAppearance"
      >
    }) =>
      sdk.client.fetch<{
        result: {
          sites_synced: number
          insights_rows_synced: number
          errors: Array<{ site_url: string; message: string }>
        }
      }>(`/admin/websites/${websiteId}/console/sync`, {
        method: "POST",
        body,
      }),
    onSuccess: () => {
      // Bust everything Search Console for this website.
      qc.invalidateQueries({ queryKey: [...consoleKeys.all] })
    },
  })
}
