import { createWorkflow, WorkflowData, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import {
  unsyncProductFromGoogleStep,
  UnsyncProductInput,
} from "../steps/unsync-product-from-google"

export const unsyncProductFromGoogleWorkflow = createWorkflow(
  "unsync-product-from-google",
  (input: WorkflowData<UnsyncProductInput>) => {
    const result = unsyncProductFromGoogleStep(input)
    return new WorkflowResponse(result)
  }
)
