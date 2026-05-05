import {
  createWorkflow,
  WorkflowData,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { deleteBindingStep, type DeleteBindingInput } from "./steps/delete-binding"

export const deleteGoogleBindingWorkflowId = "delete-google-binding-workflow"

export const deleteGoogleBindingWorkflow = createWorkflow(
  deleteGoogleBindingWorkflowId,
  function (input: WorkflowData<DeleteBindingInput>) {
    const result = deleteBindingStep(input)
    return new WorkflowResponse(result)
  }
)
