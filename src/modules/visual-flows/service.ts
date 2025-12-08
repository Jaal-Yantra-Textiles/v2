import { MedusaService } from "@medusajs/framework/utils"
import { 
  VisualFlow, 
  VisualFlowOperation, 
  VisualFlowConnection,
  VisualFlowExecution,
  VisualFlowExecutionLog,
} from "./models"

class VisualFlowService extends MedusaService({
  VisualFlow,
  VisualFlowOperation,
  VisualFlowConnection,
  VisualFlowExecution,
  VisualFlowExecutionLog,
}) {
  /**
   * Get a flow with all its operations and connections
   */
  async getFlowWithDetails(flowId: string) {
    const flow = await this.retrieveVisualFlow(flowId, {
      relations: ["operations", "connections"],
    })
    return flow
  }

  /**
   * Create a complete flow with operations and connections
   */
  async createCompleteFlow(data: {
    flow: {
      name: string
      description?: string
      status?: "active" | "inactive" | "draft"
      trigger_type: "event" | "schedule" | "webhook" | "manual" | "another_flow"
      trigger_config?: Record<string, any>
      canvas_state?: Record<string, any>
      metadata?: Record<string, any>
    }
    operations?: Array<{
      operation_key: string
      operation_type: string
      name?: string
      options?: Record<string, any>
      position_x?: number
      position_y?: number
      sort_order?: number
    }>
    connections?: Array<{
      source_id: string
      source_handle?: string
      target_id: string
      target_handle?: string
      connection_type?: "success" | "failure" | "default"
      condition?: Record<string, any>
    }>
  }) {
    // Create the flow
    const flow = await this.createVisualFlows(data.flow)

    // Create operations if provided
    if (data.operations?.length) {
      for (const op of data.operations) {
        await this.createVisualFlowOperations({
          ...op,
          flow_id: flow.id,
        } as any)
      }
    }

    // Create connections if provided
    if (data.connections?.length) {
      for (const conn of data.connections) {
        await this.createVisualFlowConnections({
          ...conn,
          flow_id: flow.id,
        } as any)
      }
    }

    return this.getFlowWithDetails(flow.id)
  }

  /**
   * Update a complete flow with operations and connections
   */
  async updateCompleteFlow(flowId: string, data: {
    name?: string
    description?: string | null
    status?: "active" | "inactive" | "draft"
    icon?: string | null
    color?: string | null
    trigger_type?: "event" | "schedule" | "webhook" | "manual" | "another_flow"
    trigger_config?: Record<string, any>
    canvas_state?: Record<string, any>
    metadata?: Record<string, any>
    operations?: Array<{
      id?: string
      operation_key: string
      operation_type: string
      name?: string | null
      options?: Record<string, any>
      position_x: number
      position_y: number
      sort_order: number
    }>
    connections?: Array<{
      id?: string
      source_id: string
      source_handle?: string
      target_id: string
      target_handle?: string
      connection_type?: "success" | "failure" | "default"
      condition?: Record<string, any> | null
      label?: string | null
      style?: Record<string, any> | null
    }>
  }) {
    // Extract operations and connections from data
    const { operations, connections, ...flowData } = data

    // Update the flow basic data
    if (Object.keys(flowData).length > 0) {
      await this.updateVisualFlows({
        id: flowId,
        ...flowData,
      })
    }

    // Update operations if provided
    if (operations !== undefined) {
      // Delete existing operations
      const existingOps = await this.listVisualFlowOperations({ flow_id: flowId } as any)
      for (const op of existingOps) {
        await this.deleteVisualFlowOperations(op.id)
      }

      // Create new operations
      for (const op of operations) {
        await this.createVisualFlowOperations({
          flow_id: flowId,
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
      const existingConns = await this.listVisualFlowConnections({ flow_id: flowId } as any)
      for (const conn of existingConns) {
        await this.deleteVisualFlowConnections(conn.id)
      }

      // Create new connections
      for (const conn of connections) {
        await this.createVisualFlowConnections({
          flow_id: flowId,
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

    return this.getFlowWithDetails(flowId)
  }

  /**
   * Update flow canvas state (React Flow positions)
   */
  async updateCanvasState(flowId: string, canvasState: Record<string, any>) {
    return this.updateVisualFlows({
      id: flowId,
      canvas_state: canvasState,
    })
  }

  /**
   * Activate a flow
   */
  async activateFlow(flowId: string) {
    return this.updateVisualFlows({
      id: flowId,
      status: "active",
    })
  }

  /**
   * Deactivate a flow
   */
  async deactivateFlow(flowId: string) {
    return this.updateVisualFlows({
      id: flowId,
      status: "inactive",
    })
  }

  /**
   * Get flow executions with logs
   */
  async getExecutionWithLogs(executionId: string) {
    return this.retrieveVisualFlowExecution(executionId, {
      relations: ["logs", "flow"],
    })
  }

  /**
   * List recent executions for a flow
   */
  async listFlowExecutions(flowId: string, limit = 50) {
    return this.listVisualFlowExecutions(
      { flow_id: flowId } as any,
      {
        order: { started_at: "DESC" },
        take: limit,
      }
    )
  }

  /**
   * Create an execution record
   */
  async createExecution(data: {
    flow_id: string
    trigger_data?: Record<string, any>
    triggered_by?: string
    metadata?: Record<string, any>
  }) {
    return this.createVisualFlowExecutions({
      ...data,
      status: "pending",
      data_chain: {
        $trigger: {
          payload: data.trigger_data || {},
          timestamp: new Date().toISOString(),
        },
        $accountability: {
          triggered_by: data.triggered_by,
        },
        $env: {},
        $last: null,
      },
    } as any)
  }

  /**
   * Update execution status
   */
  async updateExecutionStatus(
    executionId: string, 
    status: "pending" | "running" | "completed" | "failed" | "cancelled",
    updates?: {
      data_chain?: Record<string, any>
      error?: string
      error_details?: Record<string, any>
      completed_at?: Date
    }
  ) {
    return this.updateVisualFlowExecutions({
      id: executionId,
      status,
      ...updates,
    })
  }

  /**
   * Add execution log entry
   */
  async addExecutionLog(data: {
    execution_id: string
    operation_id?: string
    operation_key: string
    status: "success" | "failure" | "skipped" | "running"
    input_data?: Record<string, any>
    output_data?: Record<string, any>
    error?: string
    error_stack?: string
    duration_ms?: number
  }) {
    return this.createVisualFlowExecutionLogs({
      ...data,
      executed_at: new Date(),
    } as any)
  }

  /**
   * Get operations for a flow ordered by sort_order
   */
  async getFlowOperations(flowId: string) {
    return this.listVisualFlowOperations(
      { flow_id: flowId } as any,
      { order: { sort_order: "ASC" } }
    )
  }

  /**
   * Get connections for a flow
   */
  async getFlowConnections(flowId: string) {
    return this.listVisualFlowConnections({ flow_id: flowId } as any)
  }

  /**
   * Duplicate a flow
   */
  async duplicateFlow(flowId: string, newName?: string) {
    const original = await this.getFlowWithDetails(flowId)
    
    // Create new flow
    const newFlow = await this.createVisualFlows({
      name: newName || `${original.name} (Copy)`,
      description: original.description,
      status: "draft",
      trigger_type: original.trigger_type,
      trigger_config: original.trigger_config,
      canvas_state: original.canvas_state,
      metadata: original.metadata,
    })

    // Map old operation IDs to new ones
    const operationIdMap = new Map<string, string>()

    // Duplicate operations
    for (const op of original.operations || []) {
      const newOp = await this.createVisualFlowOperations({
        flow_id: newFlow.id,
        operation_key: op.operation_key,
        operation_type: op.operation_type,
        name: op.name,
        options: op.options,
        position_x: op.position_x,
        position_y: op.position_y,
        sort_order: op.sort_order,
      } as any)
      operationIdMap.set(op.id, newOp.id)
    }

    // Duplicate connections with updated IDs
    for (const conn of original.connections || []) {
      const newSourceId = conn.source_id === "trigger" 
        ? "trigger" 
        : operationIdMap.get(conn.source_id) || conn.source_id
      const newTargetId = operationIdMap.get(conn.target_id) || conn.target_id

      await this.createVisualFlowConnections({
        flow_id: newFlow.id,
        source_id: newSourceId,
        source_handle: conn.source_handle,
        target_id: newTargetId,
        target_handle: conn.target_handle,
        connection_type: conn.connection_type,
        condition: conn.condition,
        label: conn.label,
        style: conn.style,
      } as any)
    }

    return this.getFlowWithDetails(newFlow.id)
  }
}

export default VisualFlowService
