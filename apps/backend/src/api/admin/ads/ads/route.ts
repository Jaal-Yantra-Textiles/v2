import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import {
  resolvePlatformForAds,
  parsePositiveInt,
  toNumber,
} from "../../../../lib/ads-router"

/**
 * GET /admin/ads/ads?platform_id=...&ad_group_id=...
 *
 * Normalized individual ads (creative-level). `ad_group_id` scopes to one
 * ad group / ad set on either provider.
 *
 * Meta returns full creative bodies (headline/body/cta/url/image/video) on
 * the Ad row; Google's creative shape depends on type and is flattened on
 * sync into the GoogleAdsAd columns.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const platformId = String(req.query?.platform_id ?? "")
  const adGroupId = req.query?.ad_group_id
    ? String(req.query.ad_group_id)
    : undefined
  const limit = parsePositiveInt(req.query?.limit as string, 50, 500)
  const offset = parsePositiveInt(req.query?.offset as string, 1, 1_000_000) - 1

  const { kind } = await resolvePlatformForAds(req.scope, platformId)
  const socials = req.scope.resolve(SOCIALS_MODULE) as any

  if (kind === "google") {
    const filters: Record<string, any> = {}
    if (adGroupId) filters.ad_group_id = adGroupId
    const [rows, count] = await socials.listAndCountGoogleAdsAds(filters, {
      take: limit,
      skip: offset,
      order: { created_at: "DESC" },
    })
    return res.json({
      platform: "google" as const,
      ads: rows.map((r: any) => ({
        id: r.id,
        platform: "google" as const,
        ad_group_id: r.ad_group_id,
        provider_ad_id: r.ad_id,
        name: r.name || null,
        status: r.status,
        type: r.type || null,
        headlines: r.headlines || null,
        descriptions: r.descriptions || null,
        final_urls: r.final_urls || null,
        image_url: r.image_url || null,
        video_id: r.video_id || null,
        display_url: r.display_url || null,
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
  if (adGroupId) filters.adset_id = adGroupId
  const [rows, count] = await socials.listAndCountAds(filters, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC" },
  })
  res.json({
    platform: "meta" as const,
    ads: rows.map((r: any) => ({
      id: r.id,
      platform: "meta" as const,
      ad_group_id: r.adset_id,
      provider_ad_id: r.meta_ad_id,
      name: r.name || null,
      status: r.status,
      type: r.creative?.type || null,
      headlines: r.headline ? [{ text: r.headline }] : null,
      descriptions: r.body ? [{ text: r.body }] : null,
      final_urls: r.link_url ? [r.link_url] : null,
      image_url: r.image_url || null,
      video_id: r.video_url || null,
      display_url: r.link_url || null,
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
