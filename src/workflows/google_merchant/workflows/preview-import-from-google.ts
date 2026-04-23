import { createWorkflow, WorkflowData, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { previewImportFromGoogleStep, PreviewImportInput } from "../steps/preview-import-from-google"

export const previewImportFromGoogleWorkflow = createWorkflow(
  "preview-import-from-google",
  (input: WorkflowData<PreviewImportInput>) => {
    const result = previewImportFromGoogleStep(input)
    return new WorkflowResponse(result)
  }
)
