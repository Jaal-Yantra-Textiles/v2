import {
  createWorkflow,
  WorkflowData,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { refreshGoogleTokenStep } from "../google/steps/refresh-google-token"
import {
  listConversionActionsStep,
  type ListConversionActionsOutput,
} from "./steps/list-conversion-actions-step"

export type ListConversionActionsWorkflowInput = {
  platform_id: string
  customer_id: string
}

export const listGoogleAdsConversionActionsWorkflowId =
  "list-google-ads-conversion-actions-workflow"

/**
 * Read-side companion to `syncGoogleAdsWorkflow` — refreshes the access
 * token (no-op when fresh) and pulls conversion_action rows for one CID.
 * Used by the platform-defaults picker and (future) per-goal mapping UI.
 */
export const listGoogleAdsConversionActionsWorkflow = createWorkflow(
  listGoogleAdsConversionActionsWorkflowId,
  function (input: WorkflowData<ListConversionActionsWorkflowInput>) {
    const refreshed = refreshGoogleTokenStep({
      platform_id: input.platform_id,
      force: false,
    })

    const stepInput = transform(
      { input, refreshed },
      ({ input, refreshed }) => ({
        platform_id: input.platform_id,
        customer_id: input.customer_id,
        access_token: refreshed.access_token,
      })
    )

    const result = listConversionActionsStep(stepInput)
    return new WorkflowResponse<ListConversionActionsOutput>(result)
  }
)
