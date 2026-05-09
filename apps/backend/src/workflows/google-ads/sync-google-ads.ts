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
      })
    )

    const result = syncGoogleAdsStep(syncInput)
    return new WorkflowResponse<SyncGoogleAdsOutput>(result)
  }
)
