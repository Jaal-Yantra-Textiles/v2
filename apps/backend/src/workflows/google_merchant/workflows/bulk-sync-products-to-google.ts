import { createWorkflow, WorkflowData, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { bulkSyncProductsToGoogleStep, BulkSyncInput } from "../steps/bulk-sync-products-to-google"

export const bulkSyncProductsToGoogleWorkflow = createWorkflow(
  "bulk-sync-products-to-google",
  (input: WorkflowData<BulkSyncInput>) => {
    const result = bulkSyncProductsToGoogleStep(input)
    return new WorkflowResponse(result)
  }
)
