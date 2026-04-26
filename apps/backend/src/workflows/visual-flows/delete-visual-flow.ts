import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  deleteVisualFlowStep,
} from "./visual-flow-steps"

export type DeleteVisualFlowWorkflowInput = {
  flowId: string
}

/**
 * Workflow to delete a visual flow
 * 
 * This performs a soft delete which can be compensated
 */
export const deleteVisualFlowWorkflow = createWorkflow(
  "delete-visual-flow",
  (input: DeleteVisualFlowWorkflowInput) => {
    const result = deleteVisualFlowStep({ flowId: input.flowId })
    return new WorkflowResponse(result)
  }
)

export default deleteVisualFlowWorkflow
