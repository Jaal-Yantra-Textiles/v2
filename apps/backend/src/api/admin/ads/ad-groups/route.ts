import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import {
  resolvePlatformForAds,
  parsePositiveInt,
  toNumber,
} from "../../../../lib/ads-router"

/**
 * GET /admin/ads/ad-groups?platform_id=...&campaign_id=...
 *
 * Normalized ad groups (Google) / ad sets (Meta). `campaign_id` is optional —
 * filters to a single parent on either provider.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const platformId = String(req.query?.platform_id ?? "")
  const campaignId = req.query?.campaign_id
    ? String(req.query.campaign_id)
    : undefined
  const limit = parsePositiveInt(req.query?.limit as string, 50, 500)
  const offset = parsePositiveInt(req.query?.offset as string, 1, 1_000_000) - 1

  const { kind } = await resolvePlatformForAds(req.scope, platformId)
  const socials = req.scope.resolve(SOCIALS_MODULE) as any

  if (kind === "google") {
    const filters: Record<string, any> = {}
    if (campaignId) filters.campaign_id = campaignId

    const [rows, count] = await socials.listAndCountGoogleAdsAdGroups(
      filters,
      { take: limit, skip: offset, order: { created_at: "DESC" } }
    )
    return res.json({
      platform: "google" as const,
      ad_groups: rows.map((r: any) => ({
        id: r.id,
        platform: "google" as const,
        campaign_id: r.campaign_id,
        provider_ad_group_id: r.ad_group_id,
        name: r.name,
        status: r.status,
        type: r.type || null,
        impressions: toNumber(r.impressions),
        clicks: toNumber(r.clicks),
        conversions: toNumber(r.conversions),
        cost_micros: toNumber(r.cost_micros),
        last_synced_at: r.last_synced_at || null,
        raw: r,
      })),
      count,
      limit,
      offset,
    })
  }

  const filters: Record<string, any> = {}
  if (campaignId) filters.campaign_id = campaignId
  const [rows, count] = await socials.listAndCountAdSets(filters, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC" },
  })
  res.json({
    platform: "meta" as const,
    ad_groups: rows.map((r: any) => ({
      id: r.id,
      platform: "meta" as const,
      campaign_id: r.campaign_id,
      provider_ad_group_id: r.meta_adset_id,
      name: r.name,
      status: r.status,
      type: r.optimization_goal || null,
      impressions: toNumber(r.impressions),
      clicks: toNumber(r.clicks),
      conversions: toNumber(r.conversions),
      cost_micros: toNumber(r.spend) * 1_000_000,
      last_synced_at: r.last_synced_at || null,
      raw: r,
    })),
    count,
    limit,
    offset,
  })
}
