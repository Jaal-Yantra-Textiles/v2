import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { VISUAL_FLOWS_MODULE } from "../../modules/visual-flows"
import VisualFlowService from "../../modules/visual-flows/service"
import {
  UpdateVisualFlowInput,
  OperationInput,
  ConnectionInput,
  getFlowWithDetailsStep,
} from "./visual-flow-steps"

export type UpdateVisualFlowWorkflowInput = UpdateVisualFlowInput & {
  operations?: OperationInput[]
  connections?: ConnectionInput[]
}

/**
 * Combined step to update flow, operations, and connections atomically
 * This handles the conditional logic internally
 */
const updateFlowCompleteStep = createStep(
  "update-flow-complete-step",
  async (input: UpdateVisualFlowWorkflowInput, { container }) => {
    const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)
    
    // Store original state for compensation
    const original = await service.getFlowWithDetails(input.id)
    
    const { id, operations, connections, ...flowData } = input

    // Update flow basic data
    if (Object.keys(flowData).length > 0) {
      await service.updateVisualFlows({ id, ...flowData })
    }

    // Update operations if provided
    if (operations !== undefined) {
      // Delete existing operations
      const existingOps = await service.listVisualFlowOperations({ flow_id: id } as any)
      for (const op of existingOps) {
        await service.deleteVisualFlowOperations(op.id)
      }

      // Create new operations
      for (const op of operations) {
        await service.createVisualFlowOperations({
          flow_id: id,
          operation_key: op.operation_key,
          operation_type: op.operation_type,
          name: op.name,
          options: op.options || {},
          position_x: op.position_x,
          position_y: op.position_y,
          sort_order: op.sort_order,
        } as any)
      }
    }

    // Update connections if provided
    if (connections !== undefined) {
      // Delete existing connections
      const existingConns = await service.listVisualFlowConnections({ flow_id: id } as any)
      for (const conn of existingConns) {
        await service.deleteVisualFlowConnections(conn.id)
      }

      // Create new connections
      for (const conn of connections) {
        await service.createVisualFlowConnections({
          flow_id: id,
          source_id: conn.source_id,
          source_handle: conn.source_handle || "default",
          target_id: conn.target_id,
          target_handle: conn.target_handle || "default",
          connection_type: conn.connection_type || "default",
          condition: conn.condition,
          label: conn.label,
          style: conn.style,
        } as any)
      }
    }

    return new StepResponse({ updated: true }, original)
  },
  // Compensation: restore original state
  async (original: any, { container }) => {
    if (!original) return
    
    const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)
    
    // Restore flow basic data
    await service.updateVisualFlows({
      id: original.id,
      name: original.name,
      description: original.description,
      status: original.status,
      icon: original.icon,
      color: original.color,
      trigger_type: original.trigger_type,
      trigger_config: original.trigger_config,
      canvas_state: original.canvas_state,
      metadata: original.metadata,
    })

    // Delete current operations and restore original
    const currentOps = await service.listVisualFlowOperations({ flow_id: original.id } as any)
    for (const op of currentOps) {
      await service.deleteVisualFlowOperations(op.id)
    }
    for (const op of original.operations || []) {
      await service.createVisualFlowOperations({
        flow_id: original.id,
        operation_key: op.operation_key,
        operation_type: op.operation_type,
        name: op.name,
        options: op.options,
        position_x: op.position_x,
        position_y: op.position_y,
        sort_order: op.sort_order,
      } as any)
    }

    // Delete current connections and restore original
    const currentConns = await service.listVisualFlowConnections({ flow_id: original.id } as any)
    for (const conn of currentConns) {
      await service.deleteVisualFlowConnections(conn.id)
    }
    for (const conn of original.connections || []) {
      await service.createVisualFlowConnections({
        flow_id: original.id,
        source_id: conn.source_id,
        source_handle: conn.source_handle,
        target_id: conn.target_id,
        target_handle: conn.target_handle,
        connection_type: conn.connection_type,
        condition: conn.condition,
        label: conn.label,
        style: conn.style,
      } as any)
    }
  }
)

/**
 * Workflow to update a visual flow with operations and connections
 * 
 * Steps:
 * 1. Update flow, operations, and connections atomically
 * 2. Return complete flow with details
 * 
 * If the step fails, the original state is restored via compensation
 */
export const updateVisualFlowWorkflow = createWorkflow(
  "update-visual-flow",
  (input: UpdateVisualFlowWorkflowInput) => {
    // Step 1: Update everything atomically
    updateFlowCompleteStep(input)

    // Step 2: Get complete flow with details
    const completeFlow = getFlowWithDetailsStep({ flowId: input.id })

    return new WorkflowResponse(completeFlow)
  }
)

export default updateVisualFlowWorkflow
