import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import {
  resolvePlatformForAds,
  parsePositiveInt,
  toNumber,
} from "../../../../lib/ads-router"

/**
 * GET /admin/ads/campaigns?platform_id=...&account_id=...
 *
 * Normalized campaign list. `account_id` is optional — when present it scopes
 * to a single Meta AdAccount or Google customer (FK on either side).
 *
 * `objective_or_channel_type` is the rough equivalent across networks:
 *   Meta:   campaign.objective ("OUTCOME_LEADS", "OUTCOME_TRAFFIC", ...)
 *   Google: campaign.advertising_channel_type ("SEARCH", "DISPLAY", ...)
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const platformId = String(req.query?.platform_id ?? "")
  const accountId = req.query?.account_id
    ? String(req.query.account_id)
    : undefined
  const limit = parsePositiveInt(req.query?.limit as string, 50, 500)
  const offset = parsePositiveInt(req.query?.offset as string, 1, 1_000_000) - 1

  const { kind } = await resolvePlatformForAds(req.scope, platformId)
  const socials = req.scope.resolve(SOCIALS_MODULE) as any

  if (kind === "google") {
    const filters: Record<string, any> = {}
    if (accountId) filters.customer_id = accountId

    const [rows, count] = await socials.listAndCountGoogleAdsCampaigns(
      filters,
      { take: limit, skip: offset, order: { created_at: "DESC" } }
    )
    return res.json({
      platform: "google" as const,
      campaigns: rows.map((r: any) => ({
        id: r.id,
        platform: "google" as const,
        account_id: r.customer_id,
        provider_campaign_id: r.campaign_id,
        name: r.name,
        status: r.status,
        objective_or_channel_type: r.advertising_channel_type,
        start_date: r.start_date || null,
        end_date: r.end_date || null,
        budget_micros: toNumber(r.budget_amount_micros),
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
  if (accountId) filters.ad_account_id = accountId
  const [rows, count] = await socials.listAndCountAdCampaigns(filters, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC" },
  })
  res.json({
    platform: "meta" as const,
    campaigns: rows.map((r: any) => ({
      id: r.id,
      platform: "meta" as const,
      account_id: r.ad_account_id,
      provider_campaign_id: r.meta_campaign_id,
      name: r.name,
      status: r.status,
      objective_or_channel_type: r.objective,
      start_date: r.start_time || null,
      end_date: r.stop_time || null,
      // Meta budgets live in account currency, not micros. Convert to micros
      // so the wire shape stays uniform; UI can format with the account row's
      // currency code.
      budget_micros: toNumber(r.daily_budget || r.lifetime_budget) * 1_000_000,
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
