import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import {
  resolvePlatformForAds,
  parsePositiveInt,
  toNumber,
} from "../../../../lib/ads-router"

/**
 * GET /admin/ads/insights?platform_id=...&level=...&entity_id=...&from=...&to=...
 *
 * Time-series performance rows. `level` ∈ {customer|account, campaign, ad_group|adset, ad}.
 * `entity_id` scopes to a single entity at that level — required unless you really
 * want every row in the table.
 *
 * Date filter is inclusive: `from` / `to` are YYYY-MM-DD strings.
 *
 * Response shape normalizes Meta's AdInsights and Google's GoogleAdsInsights so
 * the same chart component can render both. Spend is always returned as
 * `cost_micros` to keep currency formatting uniform.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const platformId = String(req.query?.platform_id ?? "")
  const level = String(req.query?.level ?? "campaign").toLowerCase()
  const entityId = req.query?.entity_id ? String(req.query.entity_id) : undefined
  const fromDate = req.query?.from ? String(req.query.from) : undefined
  const toDate = req.query?.to ? String(req.query.to) : undefined
  const breakdown = req.query?.breakdown
    ? String(req.query.breakdown)
    : undefined
  const limit = parsePositiveInt(req.query?.limit as string, 200, 10_000)
  const offset = parsePositiveInt(req.query?.offset as string, 1, 10_000_000) - 1

  const { kind } = await resolvePlatformForAds(req.scope, platformId)
  const socials = req.scope.resolve(SOCIALS_MODULE) as any

  if (kind === "google") {
    const filters: Record<string, any> = { level: googleLevel(level) }
    if (entityId) {
      if (filters.level === "customer") filters.customer_id = entityId
      if (filters.level === "campaign") filters.campaign_id = entityId
      if (filters.level === "ad_group") filters.ad_group_id = entityId
      if (filters.level === "ad") filters.ad_id = entityId
    }
    if (breakdown === "device") filters.device = { $ne: null }
    if (breakdown === "network") filters.network = { $ne: null }

    const [rows, count] = await socials.listAndCountGoogleAdsInsights(
      filters,
      {
        take: limit,
        skip: offset,
        order: { date: "DESC" },
      }
    )
    const filtered = rows.filter((r: any) => {
      if (fromDate && r.date < fromDate) return false
      if (toDate && r.date > toDate) return false
      return true
    })
    return res.json({
      platform: "google" as const,
      level: filters.level,
      insights: filtered.map((r: any) => ({
        id: r.id,
        platform: "google" as const,
        level: r.level,
        date: r.date,
        entity_id:
          r.campaign_id || r.ad_group_id || r.ad_id || r.customer_id || null,
        impressions: toNumber(r.impressions),
        clicks: toNumber(r.clicks),
        ctr: r.ctr ?? null,
        cost_micros: toNumber(r.cost_micros),
        average_cpc_micros: toNumber(r.average_cpc_micros),
        average_cpm_micros: toNumber(r.average_cpm_micros),
        conversions: r.conversions ?? 0,
        conversions_value: r.conversions_value ?? null,
        all_conversions: r.all_conversions ?? null,
        view_through_conversions: r.view_through_conversions ?? null,
        video_views: toNumber(r.video_views),
        video_view_rate: r.video_view_rate ?? null,
        engagements: toNumber(r.engagements),
        engagement_rate: r.engagement_rate ?? null,
        device: r.device || null,
        network: r.network || null,
        currency_code: r.currency_code || null,
        raw: r,
      })),
      count: filtered.length,
      limit,
      offset,
    })
  }

  const filters: Record<string, any> = { level: metaLevel(level) }
  if (entityId) {
    if (filters.level === "account") filters.meta_account_id = entityId
    if (filters.level === "campaign") filters.meta_campaign_id = entityId
    if (filters.level === "adset") filters.meta_adset_id = entityId
    if (filters.level === "ad") filters.meta_ad_id = entityId
  }

  const [rows, count] = await socials.listAndCountAdInsights(filters, {
    take: limit,
    skip: offset,
    order: { date_start: "DESC" },
  })
  const filtered = rows.filter((r: any) => {
    if (fromDate && r.date_start && r.date_start < new Date(fromDate))
      return false
    if (toDate && r.date_start && r.date_start > new Date(toDate))
      return false
    return true
  })
  res.json({
    platform: "meta" as const,
    level: filters.level,
    insights: filtered.map((r: any) => {
      const isoDate = r.date_start
        ? new Date(r.date_start).toISOString().slice(0, 10)
        : null
      return {
        id: r.id,
        platform: "meta" as const,
        level: r.level,
        date: isoDate,
        entity_id:
          r.meta_campaign_id ||
          r.meta_adset_id ||
          r.meta_ad_id ||
          r.meta_account_id ||
          null,
        impressions: toNumber(r.impressions),
        clicks: toNumber(r.clicks),
        ctr: r.ctr ?? null,
        cost_micros: toNumber(r.spend) * 1_000_000,
        average_cpc_micros: r.cpc ? toNumber(r.cpc) * 1_000_000 : null,
        average_cpm_micros: r.cpm ? toNumber(r.cpm) * 1_000_000 : null,
        conversions: toNumber(r.conversions),
        conversions_value: null,
        all_conversions: null,
        view_through_conversions: null,
        video_views: toNumber(r.video_views),
        video_view_rate: null,
        engagements: toNumber(r.post_engagement),
        engagement_rate: null,
        device: r.device_platform || null,
        network: r.publisher_platform || null,
        currency_code: r.currency || null,
        raw: r,
      }
    }),
    count: filtered.length,
    limit,
    offset,
  })
}

function googleLevel(level: string): "customer" | "campaign" | "ad_group" | "ad" {
  if (level === "account" || level === "customer") return "customer"
  if (level === "adset" || level === "ad_group" || level === "ad-group")
    return "ad_group"
  if (level === "ad") return "ad"
  return "campaign"
}

function metaLevel(level: string): "account" | "campaign" | "adset" | "ad" {
  if (level === "customer" || level === "account") return "account"
  if (level === "ad_group" || level === "ad-group" || level === "adset")
    return "adset"
  if (level === "ad") return "ad"
  return "campaign"
}
