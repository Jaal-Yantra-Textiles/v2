import {
  createWorkflow,
  WorkflowData,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { refreshGoogleTokenStep } from "./steps/refresh-google-token"
import {
  listAccessibleResourcesStep,
  type ListAccessibleResourcesOutput,
} from "./steps/list-accessible-resources"
import type { GoogleService } from "../../modules/social-provider/google-connection-service"

export type ListAccessibleResourcesWorkflowInput = {
  platform_id: string
  service: GoogleService
}

export const listAccessibleResourcesWorkflowId = "list-google-accessible-resources-workflow"

/**
 * Composes the standardized auth guarantee + the per-service lookup:
 *
 *   refreshGoogleTokenStep (no-op if token has buffer headroom)
 *     → listAccessibleResourcesStep (axios → service-specific Google API)
 *
 * Workflow callers compose `refreshGoogleTokenStep` directly like this so
 * we don't pay the workflow-from-step indirection. Non-workflow callers
 * use `getValidGoogleAccessToken` instead — same step underneath.
 */
export const listAccessibleResourcesWorkflow = createWorkflow(
  listAccessibleResourcesWorkflowId,
  function (input: WorkflowData<ListAccessibleResourcesWorkflowInput>) {
    const refreshed = refreshGoogleTokenStep({
      platform_id: input.platform_id,
      force: false,
    })

    const lookupInput = transform({ input, refreshed }, ({ input, refreshed }) => ({
      platform_id: input.platform_id,
      service: input.service,
      access_token: refreshed.access_token,
    }))

    const result = listAccessibleResourcesStep(lookupInput)
    return new WorkflowResponse<ListAccessibleResourcesOutput>(result)
  }
)
