import { createWorkflow, WorkflowData, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import {
  importExistingProductsFromGoogleStep,
  ImportExistingInput,
} from "../steps/import-existing-products-from-google"

export const importExistingProductsFromGoogleWorkflow = createWorkflow(
  "import-existing-products-from-google",
  (input: WorkflowData<ImportExistingInput>) => {
    const result = importExistingProductsFromGoogleStep(input)
    return new WorkflowResponse(result)
  }
)
