import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import {
  resolvePlatformForAds,
  parsePositiveInt,
  toNumber,
} from "../../../../lib/ads-router"

/**
 * GET /admin/ads/accounts?platform_id=...
 *
 * Returns a normalized list of ad accounts (Meta) or customers (Google) for
 * the given platform. Use this when the UI just wants a flat picker list and
 * doesn't care which network it's looking at.
 *
 * Per-row response shape is normalized to:
 *   { id, platform, provider_account_id, name, currency, status, last_synced_at, raw }
 *
 * `raw` is the full underlying row — handy for UIs that want network-specific
 * extras (Meta's spend_cap, Google's is_manager, etc.).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const platformId = String(req.query?.platform_id ?? "")
  const limit = parsePositiveInt(req.query?.limit as string, 50, 200)
  const offset = parsePositiveInt(req.query?.offset as string, 1, 1_000_000) - 1

  const { kind } = await resolvePlatformForAds(req.scope, platformId)
  const socials = req.scope.resolve(SOCIALS_MODULE) as any

  if (kind === "google") {
    const [rows, count] = await socials.listAndCountGoogleAdsCustomers(
      { platform_id: platformId },
      { take: limit, skip: offset, order: { created_at: "DESC" } }
    )
    return res.json({
      platform: "google" as const,
      accounts: rows.map((r: any) => ({
        id: r.id,
        platform: "google" as const,
        provider_account_id: r.customer_id,
        name: r.descriptive_name || r.customer_id,
        currency: r.currency_code || null,
        status: r.sync_status || "unknown",
        last_synced_at: r.last_synced_at || null,
        raw: r,
      })),
      count,
      limit,
      offset,
    })
  }

  const [rows, count] = await socials.listAndCountAdAccounts(
    { platform_id: platformId },
    { take: limit, skip: offset, order: { created_at: "DESC" } }
  )
  res.json({
    platform: "meta" as const,
    accounts: rows.map((r: any) => ({
      id: r.id,
      platform: "meta" as const,
      provider_account_id: r.meta_account_id,
      name: r.name || r.business_name || r.meta_account_id,
      currency: r.currency || null,
      status: r.status || r.account_status || "unknown",
      last_synced_at: r.last_synced_at || null,
      raw: {
        ...r,
        amount_spent: toNumber(r.amount_spent),
        spend_cap: toNumber(r.spend_cap),
      },
    })),
    count,
    limit,
    offset,
  })
}
