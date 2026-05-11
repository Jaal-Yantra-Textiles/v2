import {
  createWorkflow,
  WorkflowData,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { updateBindingStep, type UpdateBindingInput } from "./steps/update-binding"

export const updateGoogleBindingWorkflowId = "update-google-binding-workflow"

export const updateGoogleBindingWorkflow = createWorkflow(
  updateGoogleBindingWorkflowId,
  function (input: WorkflowData<UpdateBindingInput>) {
    const result = updateBindingStep(input)
    return new WorkflowResponse(result)
  }
)
