import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../../lib/config"

export type StatsPanelType =
  | "metric"
  | "list"
  | "table"
  | "bar"
  | "line"
  | "area"
  | "label"

export interface StatsDashboard {
  id: string
  name: string
  description: string | null
  icon: string | null
  color: string | null
  metadata: Record<string, any>
  panels?: StatsPanel[]
  created_at: string
  updated_at: string
}

export interface StatsPanel {
  id: string
  dashboard_id: string
  name: string
  type: StatsPanelType
  x: number
  y: number
  width: number
  height: number
  operation_type: string
  operation_options: Record<string, any>
  display: Record<string, any>
  cache_ttl_seconds: number | null
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

export interface StatsOperationDefinition {
  type: string
  name: string
  description: string
  icon: string
  category: string
  defaultOptions: Record<string, any>
}

export interface PanelResolveResult {
  panel_id?: string
  data: any
  error?: string
  operation_type: string
  cache_hit: boolean
  resolved_at: string
  display?: Record<string, any>
}

const DASHBOARDS_KEY = ["stats-dashboards"] as const
const DASHBOARD_KEY = (id: string) => ["stats-dashboards", id] as const
const PANEL_DATA_KEY = (id: string) => ["stats-panel-data", id] as const
const OPERATIONS_KEY = ["stats-operations"] as const

export function useDashboards(params?: { q?: string; limit?: number; offset?: number }) {
  return useQuery({
    queryKey: [...DASHBOARDS_KEY, params],
    queryFn: async () =>
      sdk.client.fetch<{
        dashboards: StatsDashboard[]
        count: number
        limit: number
        offset: number
      }>("/admin/stats/dashboards", { method: "GET", query: params }),
  })
}

export function useDashboard(id: string | undefined) {
  return useQuery({
    queryKey: id ? DASHBOARD_KEY(id) : ["stats-dashboards", "none"],
    queryFn: async () => {
      const res = await sdk.client.fetch<{ dashboard: StatsDashboard }>(
        `/admin/stats/dashboards/${id}`,
        { method: "GET" }
      )
      return res.dashboard
    },
    enabled: !!id,
  })
}

export function useCreateDashboard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      name: string
      description?: string
      icon?: string
      color?: string
      metadata?: Record<string, any>
    }) => {
      const res = await sdk.client.fetch<{ dashboard: StatsDashboard }>(
        "/admin/stats/dashboards",
        { method: "POST", body: input }
      )
      return res.dashboard
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: DASHBOARDS_KEY }),
  })
}

export function useUpdateDashboard(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: Partial<StatsDashboard>) => {
      const res = await sdk.client.fetch<{ dashboard: StatsDashboard }>(
        `/admin/stats/dashboards/${id}`,
        { method: "PUT", body: input }
      )
      return res.dashboard
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DASHBOARDS_KEY })
      qc.invalidateQueries({ queryKey: DASHBOARD_KEY(id) })
    },
  })
}

export function useDeleteDashboard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await sdk.client.fetch(`/admin/stats/dashboards/${id}`, { method: "DELETE" })
      return id
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: DASHBOARDS_KEY }),
  })
}

export function useDuplicateDashboard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await sdk.client.fetch<{ dashboard: StatsDashboard }>(
        `/admin/stats/dashboards/${id}/duplicate`,
        { method: "POST" }
      )
      return res.dashboard
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: DASHBOARDS_KEY }),
  })
}

export function useCreatePanel(dashboardId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      name: string
      type?: StatsPanelType
      x?: number
      y?: number
      width?: number
      height?: number
      operation_type: string
      operation_options: Record<string, any>
      display?: Record<string, any>
      cache_ttl_seconds?: number | null
      metadata?: Record<string, any>
    }) => {
      const res = await sdk.client.fetch<{ panel: StatsPanel }>(
        `/admin/stats/dashboards/${dashboardId}/panels`,
        { method: "POST", body: input }
      )
      return res.panel
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: DASHBOARD_KEY(dashboardId) }),
  })
}

export function useUpdatePanel(dashboardId: string, panelId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: Partial<StatsPanel>) => {
      const res = await sdk.client.fetch<{ panel: StatsPanel }>(
        `/admin/stats/panels/${panelId}`,
        { method: "PUT", body: input }
      )
      return res.panel
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DASHBOARD_KEY(dashboardId) })
      qc.invalidateQueries({ queryKey: PANEL_DATA_KEY(panelId) })
    },
  })
}

export function useDeletePanel(dashboardId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (panelId: string) => {
      await sdk.client.fetch(`/admin/stats/panels/${panelId}`, { method: "DELETE" })
      return panelId
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: DASHBOARD_KEY(dashboardId) }),
  })
}

export function usePanelData(panelId: string | undefined, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: panelId ? PANEL_DATA_KEY(panelId) : ["stats-panel-data", "none"],
    queryFn: async () => {
      const res = await sdk.client.fetch<PanelResolveResult>(
        `/admin/stats/panels/${panelId}/data`,
        { method: "POST" }
      )
      return res
    },
    enabled: !!panelId && (options.enabled ?? true),
    staleTime: 30_000,
  })
}

export function usePreviewPanel() {
  return useMutation({
    mutationFn: async (input: {
      operation_type: string
      operation_options: Record<string, any>
      display?: Record<string, any>
    }) => {
      const res = await sdk.client.fetch<PanelResolveResult>(
        "/admin/stats/panels/preview",
        { method: "POST", body: input }
      )
      return res
    },
  })
}

export function useStatsOperations() {
  return useQuery({
    queryKey: OPERATIONS_KEY,
    queryFn: async () =>
      sdk.client.fetch<{
        operations: StatsOperationDefinition[]
        count: number
      }>("/admin/stats/operations", { method: "GET" }),
    staleTime: 5 * 60 * 1000,
  })
}
