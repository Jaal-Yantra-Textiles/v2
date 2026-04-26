import { createWorkflow, WorkflowData, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { commitImportMappingsStep, CommitImportInput } from "../steps/commit-import-mappings"

export const commitImportMappingsWorkflow = createWorkflow(
  "commit-import-mappings",
  (input: WorkflowData<CommitImportInput>) => {
    const result = commitImportMappingsStep(input)
    return new WorkflowResponse(result)
  }
)
