import {
  createWorkflow,
  WorkflowData,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { refreshGoogleTokenStep } from "../google/steps/refresh-google-token"
import {
  syncGoogleAdsStep,
  type SyncGoogleAdsOutput,
} from "./steps/sync-google-ads-step"

export type SyncGoogleAdsWorkflowInput = {
  platform_id: string
  /** Scope to a single CID; defaults to all `ads` bindings on the row. */
  customer_id?: string
  /** Sync ad-level rows + creative. Default true. */
  include_ads?: boolean
  /** Sync daily time-series into GoogleAdsInsights. Default true. */
  include_insights?: boolean
  /** Also pull device-breakdown insights. Default false. */
  include_breakdowns?: boolean
  /** Window in days for aggregates + daily insights. Default 30, max ~10y. */
  window_days?: number
  /** Explicit range start (YYYY-MM-DD). Overrides window_days — full backfill. */
  start_date?: string
  /** Explicit range end (YYYY-MM-DD). Defaults to today. */
  end_date?: string
}

export const syncGoogleAdsWorkflowId = "sync-google-ads-workflow"

/**
 * Refresh-first, then pull/upsert customers + campaigns + ad groups for
 * every Google Ads binding on this SocialPlatform row.
 *
 * Same composition pattern as `listAccessibleResourcesWorkflow` —
 * refreshGoogleTokenStep is a no-op when the token has buffer headroom.
 */
export const syncGoogleAdsWorkflow = createWorkflow(
  syncGoogleAdsWorkflowId,
  function (input: WorkflowData<SyncGoogleAdsWorkflowInput>) {
    const refreshed = refreshGoogleTokenStep({
      platform_id: input.platform_id,
      force: false,
    })

    const syncInput = transform(
      { input, refreshed },
      ({ input, refreshed }) => ({
        platform_id: input.platform_id,
        access_token: refreshed.access_token,
        customer_id: input.customer_id,
        include_ads: input.include_ads,
        include_insights: input.include_insights,
        include_breakdowns: input.include_breakdowns,
        window_days: input.window_days,
        start_date: input.start_date,
        end_date: input.end_date,
      })
    )

    const result = syncGoogleAdsStep(syncInput)
    return new WorkflowResponse<SyncGoogleAdsOutput>(result)
  }
)
