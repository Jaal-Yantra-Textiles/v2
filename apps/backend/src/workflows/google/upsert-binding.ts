import {
  createWorkflow,
  WorkflowData,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { upsertBindingStep, type UpsertBindingInput } from "./steps/upsert-binding"

export const upsertGoogleBindingWorkflowId = "upsert-google-binding-workflow"

export const upsertGoogleBindingWorkflow = createWorkflow(
  upsertGoogleBindingWorkflowId,
  function (input: WorkflowData<UpsertBindingInput>) {
    const result = upsertBindingStep(input)
    return new WorkflowResponse(result)
  }
)
