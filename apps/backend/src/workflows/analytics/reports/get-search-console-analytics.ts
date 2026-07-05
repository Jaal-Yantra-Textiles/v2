import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { SOCIALS_MODULE } from "../../../modules/socials"
import { resolveSearchConsoleBindingForWebsite } from "../../../lib/search-console-resolver"

export type GetSearchConsoleAnalyticsInput = {
  website_id: string
  days?: number
  from?: string
  to?: string
}

export type GSCMetricBucket = {
  clicks: number
  impressions: number
  ctr: number | null
  position: number | null
}

export type GSCTimeseriesPoint = GSCMetricBucket & { date: string }
export type GSCQueryRow = GSCMetricBucket & { query: string }
export type GSCPageRow = GSCMetricBucket & { page: string }

export type SearchConsoleAnalyticsOutput = {
  bound: boolean
  synced: boolean
  binding?: {
    resource_id: string
    matched_via: string
  } | null
  total: GSCMetricBucket
  timeseries: GSCTimeseriesPoint[]
  top_queries: GSCQueryRow[]
  top_pages: GSCPageRow[]
}

function toNumber(v: any): number {
  if (v === null || v === undefined || v === "") return 0
  if (typeof v === "number") return Number.isFinite(v) ? v : 0
  if (typeof v === "string") {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

export const getSearchConsoleAnalyticsStep = createStep(
  "get-search-console-analytics-step",
  async (
    input: GetSearchConsoleAnalyticsInput,
    { container }
  ): Promise<StepResponse<SearchConsoleAnalyticsOutput>> => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

    const endDate = input.to ? new Date(input.to) : new Date()
    const startDate = input.from
      ? new Date(input.from)
      : new Date(endDate.getTime() - (input.days || 30) * 24 * 60 * 60 * 1000)

    const from = startDate.toISOString().split("T")[0]
    const to = endDate.toISOString().split("T")[0]

    const { website, binding } = await resolveSearchConsoleBindingForWebsite(
      container,
      input.website_id
    )

    if (!binding) {
      return new StepResponse({
        bound: false,
        synced: false,
        total: { clicks: 0, impressions: 0, ctr: null, position: null },
        timeseries: [],
        top_queries: [],
        top_pages: [],
      })
    }

    const socials: any = container.resolve(SOCIALS_MODULE)

    const [site] = await socials.listGoogleSearchConsoleSites(
      {
        platform_id: binding.platform_id,
        site_url: binding.resource_id,
      },
      { take: 1 }
    )

    if (!site) {
      return new StepResponse({
        bound: true,
        synced: false,
        binding: { resource_id: binding.resource_id, matched_via: binding.matched_via },
        total: { clicks: 0, impressions: 0, ctr: null, position: null },
        timeseries: [],
        top_queries: [],
        top_pages: [],
      })
    }

    const raw = await socials.listGoogleSearchConsoleInsights(
      { site_id: site.id },
      { take: 200_000, order: { date: "ASC" } }
    )

    const inWindow = raw.filter((r: any) => r.date >= from && r.date <= to)

    if (inWindow.length === 0) {
      return new StepResponse({
        bound: true,
        synced: true,
        binding: { resource_id: binding.resource_id, matched_via: binding.matched_via },
        total: { clicks: 0, impressions: 0, ctr: null, position: null },
        timeseries: [],
        top_queries: [],
        top_pages: [],
      })
    }

    let totalClicks = 0
    let totalImpressions = 0
    let positionNum = 0
    let positionDen = 0

    for (const r of inWindow) {
      totalClicks += toNumber(r.clicks)
      totalImpressions += toNumber(r.impressions)
      if (r.position !== null && r.position !== undefined) {
        positionNum += (Number(r.position) || 0) * toNumber(r.impressions)
        positionDen += toNumber(r.impressions)
      }
    }

    const total: GSCMetricBucket = {
      clicks: totalClicks,
      impressions: totalImpressions,
      ctr: totalImpressions ? totalClicks / totalImpressions : null,
      position: positionDen ? positionNum / positionDen : null,
    }

    const byDate = new Map<string, { clicks: number; impressions: number; positionNum: number; positionDen: number }>()
    const byQuery = new Map<string, { clicks: number; impressions: number; positionNum: number; positionDen: number }>()
    const byPage = new Map<string, { clicks: number; impressions: number; positionNum: number; positionDen: number }>()

    for (const r of inWindow) {
      const d = byDate.get(r.date) || { clicks: 0, impressions: 0, positionNum: 0, positionDen: 0 }
      d.clicks += toNumber(r.clicks)
      d.impressions += toNumber(r.impressions)
      if (r.position !== null && r.position !== undefined) {
        d.positionNum += (Number(r.position) || 0) * toNumber(r.impressions)
        d.positionDen += toNumber(r.impressions)
      }
      byDate.set(r.date, d)

      if (r.query) {
        const q = byQuery.get(r.query) || { clicks: 0, impressions: 0, positionNum: 0, positionDen: 0 }
        q.clicks += toNumber(r.clicks)
        q.impressions += toNumber(r.impressions)
        if (r.position !== null && r.position !== undefined) {
          q.positionNum += (Number(r.position) || 0) * toNumber(r.impressions)
          q.positionDen += toNumber(r.impressions)
        }
        byQuery.set(r.query, q)
      }

      if (r.page) {
        const p = byPage.get(r.page) || { clicks: 0, impressions: 0, positionNum: 0, positionDen: 0 }
        p.clicks += toNumber(r.clicks)
        p.impressions += toNumber(r.impressions)
        if (r.position !== null && r.position !== undefined) {
          p.positionNum += (Number(r.position) || 0) * toNumber(r.impressions)
          p.positionDen += toNumber(r.impressions)
        }
        byPage.set(r.page, p)
      }
    }

    const timeseries: GSCTimeseriesPoint[] = [...byDate.entries()]
      .map(([date, s]) => ({
        date,
        clicks: s.clicks,
        impressions: s.impressions,
        ctr: s.impressions ? s.clicks / s.impressions : null,
        position: s.positionDen ? s.positionNum / s.positionDen : null,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const topQueries: GSCQueryRow[] = [...byQuery.entries()]
      .map(([query, s]) => ({
        query,
        clicks: s.clicks,
        impressions: s.impressions,
        ctr: s.impressions ? s.clicks / s.impressions : null,
        position: s.positionDen ? s.positionNum / s.positionDen : null,
      }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 10)

    const topPages: GSCPageRow[] = [...byPage.entries()]
      .map(([page, s]) => ({
        page,
        clicks: s.clicks,
        impressions: s.impressions,
        ctr: s.impressions ? s.clicks / s.impressions : null,
        position: s.positionDen ? s.positionNum / s.positionDen : null,
      }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 10)

    logger.info(
      `[GSC Analytics] website=${input.website_id} bound=${binding.resource_id} clicks=${totalClicks} impressions=${totalImpressions}`
    )

    return new StepResponse({
      bound: true,
      synced: true,
      binding: { resource_id: binding.resource_id, matched_via: binding.matched_via },
      total,
      timeseries,
      top_queries: topQueries,
      top_pages: topPages,
    })
  }
)

export const getSearchConsoleAnalyticsWorkflow = createWorkflow(
  "get-search-console-analytics",
  (input: GetSearchConsoleAnalyticsInput) => {
    const result = getSearchConsoleAnalyticsStep(input)
    return new WorkflowResponse(result)
  }
)
