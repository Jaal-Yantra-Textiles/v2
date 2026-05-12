import {
  createWorkflow,
  WorkflowData,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { refreshGoogleTokenStep } from "../google/steps/refresh-google-token"
import {
  syncSearchConsoleStep,
  type SyncSearchConsoleOutput,
} from "./steps/sync-search-console-step"

export type SyncSearchConsoleWorkflowInput = {
  platform_id: string
  /** Scope to a single site_url; defaults to all `search-console` bindings on the row. */
  site_url?: string
  /** Window in days; default 28 (GSC's default). */
  window_days?: number
  dimensions?: Array<
    "date" | "query" | "page" | "country" | "device" | "searchAppearance"
  >
  row_limit?: number
}

export const syncSearchConsoleWorkflowId = "sync-google-search-console-workflow"

/**
 * Refresh-first, then pull Search Analytics for every Search Console
 * binding on this platform. Mirror of `syncGoogleAdsWorkflow` — same
 * shape, same composition pattern.
 */
export const syncSearchConsoleWorkflow = createWorkflow(
  syncSearchConsoleWorkflowId,
  function (input: WorkflowData<SyncSearchConsoleWorkflowInput>) {
    const refreshed = refreshGoogleTokenStep({
      platform_id: input.platform_id,
      force: false,
    })

    const syncInput = transform(
      { input, refreshed },
      ({ input, refreshed }) => ({
        platform_id: input.platform_id,
        access_token: refreshed.access_token,
        site_url: input.site_url,
        window_days: input.window_days,
        dimensions: input.dimensions,
        row_limit: input.row_limit,
      })
    )

    const result = syncSearchConsoleStep(syncInput)
    return new WorkflowResponse<SyncSearchConsoleOutput>(result)
  }
)
