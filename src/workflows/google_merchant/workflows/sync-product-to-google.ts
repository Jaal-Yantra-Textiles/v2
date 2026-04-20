import { createWorkflow, WorkflowData, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { syncProductToGoogleStep, SyncProductToGoogleInput } from "../steps/sync-product-to-google"

export const syncProductToGoogleWorkflow = createWorkflow(
  "sync-product-to-google",
  (input: WorkflowData<SyncProductToGoogleInput>) => {
    const result = syncProductToGoogleStep(input)
    return new WorkflowResponse(result)
  }
)
