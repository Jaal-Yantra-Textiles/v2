import {
  createStep,
  StepResponse,
} from "@medusajs/framework/workflows-sdk"
import { VISUAL_FLOWS_MODULE } from "../../modules/visual-flows"
import VisualFlowService from "../../modules/visual-flows/service"

// ============ Types ============

export type CreateVisualFlowInput = {
  name: string
  description?: string | null
  status?: "active" | "inactive" | "draft"
  icon?: string | null
  color?: string | null
  trigger_type: "event" | "schedule" | "webhook" | "manual" | "another_flow"
  trigger_config?: Record<string, any>
  canvas_state?: Record<string, any>
  metadata?: Record<string, any>
}

export type UpdateVisualFlowInput = {
  id: string
  name?: string
  description?: string | null
  status?: "active" | "inactive" | "draft"
  icon?: string | null
  color?: string | null
  trigger_type?: "event" | "schedule" | "webhook" | "manual" | "another_flow"
  trigger_config?: Record<string, any>
  canvas_state?: Record<string, any>
  metadata?: Record<string, any>
}

export type OperationInput = {
  id?: string
  operation_key: string
  operation_type: string
  name?: string | null
  options?: Record<string, any>
  position_x: number
  position_y: number
  sort_order: number
}

export type ConnectionInput = {
  id?: string
  source_id: string
  source_handle?: string
  target_id: string
  target_handle?: string
  connection_type?: "success" | "failure" | "default"
  condition?: Record<string, any> | null
  label?: string | null
  style?: Record<string, any> | null
}

// ============ Steps ============

/**
 * Create a visual flow
 */
export const createVisualFlowStep = createStep(
  "create-visual-flow-step",
  async (input: CreateVisualFlowInput, { container }) => {
    const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)
    const flow = await service.createVisualFlows(input)
    return new StepResponse(flow, flow.id)
  },
  // Compensation: delete the created flow
  async (flowId: string, { container }) => {
    const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)
    await service.softDeleteVisualFlows(flowId)
  }
)

/**
 * Update a visual flow's basic data
 */
export const updateVisualFlowStep = createStep(
  "update-visual-flow-step",
  async (input: UpdateVisualFlowInput, { container }) => {
    const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)
    
    // Store original data for compensation
    const original = await service.retrieveVisualFlow(input.id)
    
    const { id, ...updateData } = input
    const flow = await service.updateVisualFlows({ id, ...updateData })
    
    return new StepResponse(flow, { id, original })
  },
  // Compensation: restore original data
  async (data: { id: string; original: any }, { container }) => {
    const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)
    const { id, original } = data
    await service.updateVisualFlows({
      id,
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
  }
)

/**
 * Delete existing operations for a flow
 */
export const deleteFlowOperationsStep = createStep(
  "delete-flow-operations-step",
  async (input: { flowId: string }, { container }) => {
    const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)
    
    // Get existing operations for compensation
    const existingOps = await service.listVisualFlowOperations({ flow_id: input.flowId } as any)
    
    // Delete all operations
    for (const op of existingOps) {
      await service.deleteVisualFlowOperations(op.id)
    }
    
    return new StepResponse({ deleted: existingOps.length }, { flowId: input.flowId, operations: existingOps })
  },
  // Compensation: restore deleted operations
  async (data: { flowId: string; operations: any[] }, { container }) => {
    const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)
    for (const op of data.operations) {
      await service.createVisualFlowOperations({
        flow_id: data.flowId,
        operation_key: op.operation_key,
        operation_type: op.operation_type,
        name: op.name,
        options: op.options,
        position_x: op.position_x,
        position_y: op.position_y,
        sort_order: op.sort_order,
      } as any)
    }
  }
)

/**
 * Create operations for a flow
 */
export const createFlowOperationsStep = createStep(
  "create-flow-operations-step",
  async (input: { flowId: string; operations: OperationInput[] }, { container }) => {
    const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)
    
    const createdIds: string[] = []
    
    for (const op of input.operations) {
      const created = await service.createVisualFlowOperations({
        flow_id: input.flowId,
        operation_key: op.operation_key,
        operation_type: op.operation_type,
        name: op.name,
        options: op.options || {},
        position_x: op.position_x,
        position_y: op.position_y,
        sort_order: op.sort_order,
      } as any)
      createdIds.push(created.id)
    }
    
    return new StepResponse({ created: createdIds.length, ids: createdIds }, createdIds)
  },
  // Compensation: delete created operations
  async (createdIds: string[], { container }) => {
    const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)
    for (const id of createdIds) {
      await service.deleteVisualFlowOperations(id)
    }
  }
)

/**
 * Delete existing connections for a flow
 */
export const deleteFlowConnectionsStep = createStep(
  "delete-flow-connections-step",
  async (input: { flowId: string }, { container }) => {
    const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)
    
    // Get existing connections for compensation
    const existingConns = await service.listVisualFlowConnections({ flow_id: input.flowId } as any)
    
    // Delete all connections
    for (const conn of existingConns) {
      await service.deleteVisualFlowConnections(conn.id)
    }
    
    return new StepResponse({ deleted: existingConns.length }, { flowId: input.flowId, connections: existingConns })
  },
  // Compensation: restore deleted connections
  async (data: { flowId: string; connections: any[] }, { container }) => {
    const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)
    for (const conn of data.connections) {
      await service.createVisualFlowConnections({
        flow_id: data.flowId,
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
 * Create connections for a flow
 */
export const createFlowConnectionsStep = createStep(
  "create-flow-connections-step",
  async (input: { flowId: string; connections: ConnectionInput[] }, { container }) => {
    const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)
    
    const createdIds: string[] = []
    
    for (const conn of input.connections) {
      const created = await service.createVisualFlowConnections({
        flow_id: input.flowId,
        source_id: conn.source_id,
        source_handle: conn.source_handle || "default",
        target_id: conn.target_id,
        target_handle: conn.target_handle || "default",
        connection_type: conn.connection_type || "default",
        condition: conn.condition,
        label: conn.label,
        style: conn.style,
      } as any)
      createdIds.push(created.id)
    }
    
    return new StepResponse({ created: createdIds.length, ids: createdIds }, createdIds)
  },
  // Compensation: delete created connections
  async (createdIds: string[], { container }) => {
    const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)
    for (const id of createdIds) {
      await service.deleteVisualFlowConnections(id)
    }
  }
)

/**
 * Get flow with all details
 */
export const getFlowWithDetailsStep = createStep(
  "get-flow-with-details-step",
  async (input: { flowId: string }, { container }) => {
    const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)
    const flow = await service.getFlowWithDetails(input.flowId)
    return new StepResponse(flow)
  }
)

/**
 * Delete a visual flow (soft delete)
 */
export const deleteVisualFlowStep = createStep(
  "delete-visual-flow-step",
  async (input: { flowId: string }, { container }) => {
    const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)
    
    // Store original for compensation
    const original = await service.getFlowWithDetails(input.flowId)
    
    await service.softDeleteVisualFlows(input.flowId)
    
    return new StepResponse({ deleted: true }, original)
  },
  // Compensation: restore the flow (would need a restore method)
  async (original: any, { container }) => {
    const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)
    // Note: MedusaService doesn't have a built-in restore, 
    // but we can recreate with the same data
    await service.restoreVisualFlows(original.id)
  }
)
