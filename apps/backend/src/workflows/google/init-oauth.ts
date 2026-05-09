import {
  createWorkflow,
  WorkflowData,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  buildGoogleAuthUrlStep,
  type BuildGoogleAuthUrlInput,
  type BuildGoogleAuthUrlOutput,
} from "./steps/build-google-auth-url"

export const initGoogleOauthWorkflowId = "init-google-oauth-workflow"

export const initGoogleOauthWorkflow = createWorkflow(
  initGoogleOauthWorkflowId,
  function (input: WorkflowData<BuildGoogleAuthUrlInput>) {
    const result = buildGoogleAuthUrlStep(input)
    return new WorkflowResponse<BuildGoogleAuthUrlOutput>(result)
  }
)
