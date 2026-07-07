import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import { FX_RATES_MODULE } from "../../../../modules/fx_rates"
import { resolveStoreCurrency } from "../../../../lib/resolve-store-currency"
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

  // Base-currency normalization (on-read, latest rate). Target = an explicit
  // `?display_currency=` (multi-currency ready) or the platform base (EUR). Spend
  // is stored in the ad account's native currency; we add *_base fields alongside
  // the raw micros rather than mutating them, so the provider value is preserved.
  // Uses the latest cached FX rate — a small, documented error on historical rows.
  const displayCurrency = req.query?.display_currency
    ? String(req.query.display_currency).toLowerCase()
    : undefined
  const baseCurrency =
    displayCurrency ||
    (await resolveStoreCurrency(req.scope, { fallback: "eur" }))
  let fx: any = null
  try {
    fx = req.scope.resolve(FX_RATES_MODULE)
  } catch {
    // FX module unavailable — *_base fields will be null.
  }

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
    const rateMap = await buildRateMap(
      fx,
      filtered.map((r: any) => r.currency_code),
      baseCurrency
    )
    return res.json({
      platform: "google" as const,
      level: filters.level,
      base_currency: baseCurrency,
      insights: filtered.map((r: any) => {
        const rate = rateMap.get((r.currency_code || "").toLowerCase())
        const conv = (m: number | null) =>
          rate != null && m != null ? Math.round(m * rate) : null
        return {
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
          cost_micros_base: conv(toNumber(r.cost_micros)),
          average_cpc_micros_base: conv(toNumber(r.average_cpc_micros)),
          average_cpm_micros_base: conv(toNumber(r.average_cpm_micros)),
          base_currency: baseCurrency,
          fx_rate: rate ?? null,
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
        }
      }),
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
  const rateMap = await buildRateMap(
    fx,
    filtered.map((r: any) => r.currency),
    baseCurrency
  )
  res.json({
    platform: "meta" as const,
    level: filters.level,
    base_currency: baseCurrency,
    insights: filtered.map((r: any) => {
      const isoDate = r.date_start
        ? new Date(r.date_start).toISOString().slice(0, 10)
        : null
      const rate = rateMap.get((r.currency || "").toLowerCase())
      const conv = (m: number | null) =>
        rate != null && m != null ? Math.round(m * rate) : null
      const costMicros = toNumber(r.spend) * 1_000_000
      const cpcMicros = r.cpc ? toNumber(r.cpc) * 1_000_000 : null
      const cpmMicros = r.cpm ? toNumber(r.cpm) * 1_000_000 : null
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
        cost_micros: costMicros,
        average_cpc_micros: cpcMicros,
        average_cpm_micros: cpmMicros,
        cost_micros_base: conv(costMicros),
        average_cpc_micros_base: conv(cpcMicros),
        average_cpm_micros_base: conv(cpmMicros),
        base_currency: baseCurrency,
        fx_rate: rate ?? null,
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

/**
 * Build a `nativeCurrency(lower) -> rate` map to the base currency, one FX
 * lookup per distinct currency (result sets are usually a single currency).
 * Same currency -> 1; missing FX module / no cached rate -> null (caller emits
 * null *_base fields rather than a wrong number). Latest rate, applied on read.
 */
export async function buildRateMap(
  fx: any,
  currencies: Array<string | null | undefined>,
  base: string
): Promise<Map<string, number | null>> {
  const map = new Map<string, number | null>()
  const target = (base || "").toLowerCase()
  for (const raw of currencies) {
    const from = (raw || "").toLowerCase()
    if (map.has(from)) continue
    if (!from) {
      map.set(from, null)
      continue
    }
    if (from === target) {
      map.set(from, 1)
      continue
    }
    if (!fx) {
      map.set(from, null)
      continue
    }
    try {
      map.set(from, await fx.getRate(from, target))
    } catch {
      map.set(from, null)
    }
  }
  return map
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
