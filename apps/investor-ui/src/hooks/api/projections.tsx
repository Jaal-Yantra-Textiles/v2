import { useQuery } from "@tanstack/react-query"
import { sdk } from "../../lib/client"

// Investor Projections tab data. Two sources:
//  1. Admin-authored stats panels flagged `metadata.investor === true`, resolved
//     through the investor-scoped resolver (marketing/growth/ads metrics).
//  2. The investor's own position (bespoke, per-investor).

export type InvestorPanel = {
  id: string
  dashboard_id?: string
  name: string
  type: string
  x?: number
  y?: number
  width?: number
  height?: number
  display?: Record<string, any>
  operation_type: string
}

export type PanelData = {
  panel_id: string
  name?: string
  type?: string
  data: any
  error?: string
  operation_type: string
  resolved_at: string
  display?: Record<string, any>
}

export type ProjectionPosition = {
  cap_table_id: string
  cap_table_name: string
  company_id?: string
  currency_code?: string | null
  my_shares: number
  my_invested: number
  shares_outstanding?: number | null
  ownership_pct?: number | null
  post_money_valuation?: number | null
  implied_value?: number | null
  multiple?: number | null
  stake_count: number
}

export type ProjectionPortfolio = {
  total_invested: number
  total_implied_value: number
  blended_multiple: number | null
  cap_tables: number
}

export const projectionsQueryKeys = {
  panels: ["investor-panels"] as const,
  panelData: (id: string) => ["investor-panel-data", id] as const,
  myProjections: ["investor-my-projections"] as const,
}

export const useInvestorPanels = () => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ panels: InvestorPanel[]; count: number }>(
        "/investors/stats/panels",
        { method: "GET" }
      ),
    queryKey: projectionsQueryKeys.panels,
  })
  return { panels: data?.panels ?? [], count: data?.count ?? 0, ...rest }
}

export const useInvestorPanelData = (id: string, enabled = true) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<PanelData>(`/investors/stats/panels/${id}/data`, {
        method: "GET",
      }),
    queryKey: projectionsQueryKeys.panelData(id),
    enabled: enabled && !!id,
  })
  return { panel: data, ...rest }
}

export const useMyProjections = () => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{
        positions: ProjectionPosition[]
        portfolio: ProjectionPortfolio
        count: number
      }>("/investors/me/projections", { method: "GET" }),
    queryKey: projectionsQueryKeys.myProjections,
  })
  return {
    positions: data?.positions ?? [],
    portfolio: data?.portfolio,
    count: data?.count ?? 0,
    ...rest,
  }
}
