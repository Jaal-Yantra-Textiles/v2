import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { resolvePlatformForAds } from "../../../../lib/ads-router"
import { syncGoogleAdsWorkflow } from "../../../../workflows/google-ads/sync-google-ads"

type SyncBody = {
  platform_id: string
  /** Optional CID / Meta account ID — scopes the sync to a single account row. */
  account_id?: string
  /** Google-only flags (ignored for Meta). */
  include_ads?: boolean
  include_insights?: boolean
  include_breakdowns?: boolean
  window_days?: number
  /** Explicit range (YYYY-MM-DD). start_date overrides window_days — full backfill. */
  start_date?: string
  end_date?: string
}

/**
 * POST /admin/ads/sync
 *
 * Dispatches to the right provider's sync workflow based on platform.category.
 * Meta sync today still lives on `/admin/meta-ads/*` — this endpoint returns a
 * clear "not yet wired" response for Meta rather than silently no-op'ing,
 * so the UI can fall back to the legacy routes.
 */
export const POST = async (req: MedusaRequest<SyncBody>, res: MedusaResponse) => {
  const body = (req.body || {}) as SyncBody
  if (!body.platform_id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "platform_id is required"
    )
  }

  const { kind } = await resolvePlatformForAds(req.scope, body.platform_id)

  if (kind === "google") {
    const { result } = await syncGoogleAdsWorkflow(req.scope).run({
      input: {
        platform_id: body.platform_id,
        customer_id: body.account_id,
        include_ads: body.include_ads,
        include_insights: body.include_insights,
        include_breakdowns: body.include_breakdowns,
        window_days: body.window_days,
        start_date: body.start_date,
        end_date: body.end_date,
      },
    })
    return res.status(200).json({ platform: "google" as const, result })
  }

  // Meta uses a different sync surface today (`/admin/meta-ads/accounts/sync`,
  // `/admin/meta-ads/campaigns/sync`, `/admin/meta-ads/insights/sync`). Pointing
  // at it from here means duplicating a lot of token-decrypt + access-check
  // logic; cleaner to return a hint so the UI hits the legacy routes directly
  // until the Meta workflows are folded in.
  res.status(200).json({
    platform: "meta" as const,
    result: null,
    hint: "Meta sync is not yet routed through /admin/ads/sync. Hit /admin/meta-ads/accounts/sync, /admin/meta-ads/campaigns/sync, /admin/meta-ads/insights/sync.",
  })
}
