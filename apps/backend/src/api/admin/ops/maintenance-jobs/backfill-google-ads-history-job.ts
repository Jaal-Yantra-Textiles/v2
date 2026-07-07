import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { resolvePlatformForAds } from "../../../../lib/ads-router"
import { syncGoogleAdsWorkflow } from "../../../../workflows/google-ads/sync-google-ads"
import { resolveSyncDateRange } from "../../../../workflows/google-ads/steps/sync-google-ads-step"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * Data Plumbing — backfill Google Ads history for a SocialPlatform.
 *
 * The regular sync (`POST /admin/ads/sync`) defaults to a 30-day window. This
 * job runs the SAME `syncGoogleAdsWorkflow` but over a WIDE range so all
 * historical campaigns / ad-groups / ads / daily-insights get pulled and
 * upserted (insights rows are keyed per (level, entity, date, device, network),
 * so re-running just backfills older dates + updates in place — no duplicates).
 *
 * Window: pass `start_date` (YYYY-MM-DD) for a true full backfill; otherwise it
 * defaults to a 2-year `window_days`. Dates go through `segments.date BETWEEN`
 * (NOT the `LAST_N_DAYS` literal, which only allows 7/14/30) — see
 * resolveSyncDateRange.
 *
 * Dry-run previews the resolved sync window WITHOUT calling Google or writing.
 * Apply runs the workflow and reports how many rows synced; per-CID failures are
 * recorded in `errors` (the workflow is best-effort per account).
 */

// Default lookback for a backfill when no explicit start_date is given (2y).
export const DEFAULT_BACKFILL_WINDOW_DAYS = 730

const backfillGoogleAdsHistoryParamsSchema = z.object({
  platform_id: z.string().min(1, "platform_id is required"),
  /** Scope to a single CID; defaults to all `ads` bindings on the platform. */
  account_id: z.string().min(1).optional(),
  /** Full-backfill range start (YYYY-MM-DD). Overrides window_days. */
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "start_date must be YYYY-MM-DD")
    .optional(),
  /** Range end (YYYY-MM-DD). Defaults to today. */
  end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "end_date must be YYYY-MM-DD")
    .optional(),
  /** Lookback in days when no start_date (default 2y). */
  window_days: z.number().int().positive().optional(),
  include_insights: z.boolean().optional().default(true),
  include_ads: z.boolean().optional().default(true),
  include_breakdowns: z.boolean().optional().default(false),
})

export const backfillGoogleAdsHistoryJob: MaintenanceJob = {
  id: "backfill-google-ads-history",
  label: "Backfill Google Ads history",
  description:
    `Pull ALL historical Google Ads data (campaigns, ad-groups, ads, daily insights) for a platform by running the sync over a wide date range instead of the default 30 days. Pass start_date (YYYY-MM-DD) for a full backfill, else it looks back ${DEFAULT_BACKFILL_WINDOW_DAYS} days. Idempotent — insights are keyed per (level, entity, date) so re-runs backfill older dates and update in place. Dry-run previews the resolved window WITHOUT calling Google or writing; apply runs the sync and reports rows synced (per-account failures are listed, not fatal).`,
  params: [
    {
      name: "platform_id",
      type: "string",
      required: true,
      description: "SocialPlatform id (Google Ads) to backfill",
    },
    {
      name: "account_id",
      type: "string",
      required: false,
      description: "Single CID to scope to (default: all bound accounts)",
    },
    {
      name: "start_date",
      type: "string",
      required: false,
      description: "Full-backfill range start (YYYY-MM-DD). Overrides window_days.",
    },
    {
      name: "end_date",
      type: "string",
      required: false,
      description: "Range end (YYYY-MM-DD). Defaults to today.",
    },
    {
      name: "window_days",
      type: "number",
      required: false,
      description: `Lookback in days when no start_date (default ${DEFAULT_BACKFILL_WINDOW_DAYS})`,
    },
    {
      name: "include_insights",
      type: "boolean",
      required: false,
      description: "Pull daily time-series insights (default true)",
    },
    {
      name: "include_ads",
      type: "boolean",
      required: false,
      description: "Pull ad-level rows + creative (default true)",
    },
    {
      name: "include_breakdowns",
      type: "boolean",
      required: false,
      description: "Also pull device-breakdown insights (default false)",
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = backfillGoogleAdsHistoryParamsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const {
      platform_id,
      account_id,
      start_date,
      end_date,
      window_days,
      include_insights,
      include_ads,
      include_breakdowns,
    } = parsed.data

    // Only Google platforms flow through this workflow — mirror the sync route.
    const { kind } = await resolvePlatformForAds(container, platform_id)
    if (kind !== "google") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Platform ${platform_id} is not a Google Ads platform (kind=${kind}); this job backfills Google Ads only`
      )
    }

    // No explicit start_date → default to a wide lookback so it's a real backfill.
    const effectiveWindowDays =
      start_date != null ? undefined : window_days ?? DEFAULT_BACKFILL_WINDOW_DAYS

    const range = resolveSyncDateRange({
      window_days: effectiveWindowDays,
      start_date,
      end_date,
    })

    const windowChange: MaintenanceChange = {
      entity: "social_platform",
      id: platform_id,
      field: "sync_window",
      before: null,
      after: `${range.start} → ${range.end}${account_id ? ` (cid ${account_id})` : ""}`,
    }

    if (dry_run) {
      return {
        job_id: backfillGoogleAdsHistoryJob.id,
        dry_run,
        applied: false,
        summary: `Would sync Google Ads for platform ${platform_id} over ${range.start} → ${range.end}${account_id ? ` (cid ${account_id})` : " (all bound accounts)"}`,
        changes: [windowChange],
      }
    }

    const { result } = await syncGoogleAdsWorkflow(container).run({
      input: {
        platform_id,
        customer_id: account_id,
        include_ads,
        include_insights,
        include_breakdowns,
        start_date: range.start,
        end_date: range.end,
      },
    })

    const errors = (result.errors ?? []).map((e) => ({
      id: e.customer_id,
      message: e.message,
    }))
    const synced =
      result.customers_synced +
      result.campaigns_synced +
      result.ad_groups_synced +
      result.ads_synced +
      result.insights_rows_synced

    return {
      job_id: backfillGoogleAdsHistoryJob.id,
      dry_run,
      applied: synced > 0,
      summary: `Synced ${result.customers_synced} customer(s), ${result.campaigns_synced} campaign(s), ${result.ad_groups_synced} ad-group(s), ${result.ads_synced} ad(s), ${result.insights_rows_synced} insights row(s) over ${range.start} → ${range.end}${errors.length ? `; ${errors.length} account error(s)` : ""}`,
      changes: [windowChange],
      errors,
    }
  },
}

export default backfillGoogleAdsHistoryJob
