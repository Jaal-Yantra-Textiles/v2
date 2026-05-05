import {
  createWorkflow,
  WorkflowData,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  refreshGoogleTokenStep,
  type RefreshGoogleTokenInput,
  type RefreshGoogleTokenOutput,
} from "./steps/refresh-google-token"

export const refreshGoogleTokenWorkflowId = "refresh-google-token-workflow"

/**
 * Public refresh entry point. Two callers:
 *   1. Admin route POST /admin/social-platforms/[id]/google/refresh-token
 *      — operator-triggered, useful when verifying the refresh chain.
 *   2. `getValidGoogleAccessToken` utility — invoked from inside any other
 *      Google API step that needs a guaranteed-fresh access token.
 *
 * No-op cost is one DB read when `force=false` and the stored token has
 * buffer headroom (handled inside the step).
 */
export const refreshGoogleTokenWorkflow = createWorkflow(
  refreshGoogleTokenWorkflowId,
  function (input: WorkflowData<RefreshGoogleTokenInput>) {
    const result = refreshGoogleTokenStep(input)
    return new WorkflowResponse<RefreshGoogleTokenOutput>(result)
  }
)
