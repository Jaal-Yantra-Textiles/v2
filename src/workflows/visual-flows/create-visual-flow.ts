import {
  createWorkflow,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import {
  createVisualFlowStep,
  createFlowOperationsStep,
  createFlowConnectionsStep,
  getFlowWithDetailsStep,
  CreateVisualFlowInput,
  OperationInput,
  ConnectionInput,
} from "./visual-flow-steps"

export type CreateVisualFlowWorkflowInput = CreateVisualFlowInput & {
  operations?: OperationInput[]
  connections?: ConnectionInput[]
}

/**
 * Workflow to create a visual flow with operations and connections
 * 
 * Steps:
 * 1. Create the flow
 * 2. Create operations (if provided)
 * 3. Create connections (if provided)
 * 4. Return complete flow with details
 * 
 * If any step fails, previous steps are compensated (rolled back)
 */
export const createVisualFlowWorkflow = createWorkflow(
  "create-visual-flow",
  (input: CreateVisualFlowWorkflowInput) => {
    // Step 1: Create the flow
    const flow = createVisualFlowStep({
      name: input.name,
      description: input.description,
      status: input.status,
      icon: input.icon,
      color: input.color,
      trigger_type: input.trigger_type,
      trigger_config: input.trigger_config,
      canvas_state: input.canvas_state,
      metadata: input.metadata,
    })

    // Transform to ensure arrays are never undefined
    const operationsData = transform(
      { flowId: flow.id, operations: input.operations },
      (data) => ({
        flowId: data.flowId,
        operations: data.operations || [],
      })
    )

    const connectionsData = transform(
      { flowId: flow.id, connections: input.connections },
      (data) => ({
        flowId: data.flowId,
        connections: data.connections || [],
      })
    )

    // Step 2: Create operations
    createFlowOperationsStep(operationsData)

    // Step 3: Create connections
    createFlowConnectionsStep(connectionsData)

    // Step 4: Get complete flow with details
    const completeFlow = getFlowWithDetailsStep({ flowId: flow.id })

    return new WorkflowResponse(completeFlow)
  }
)

export default createVisualFlowWorkflow
