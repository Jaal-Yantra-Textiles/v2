import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { VISUAL_FLOWS_MODULE } from "../../modules/visual-flows"
import VisualFlowService from "../../modules/visual-flows/service"
import { 
  operationRegistry, 
  DataChain, 
  OperationContext,
  getAllowedEnvVars,
  interpolateVariables,
} from "../../modules/visual-flows/operations"

// ============ Types ============

export type ExecuteVisualFlowInput = {
  flowId: string
  triggerData?: Record<string, any>
  triggeredBy?: string
  metadata?: Record<string, any>
}

type ExecutionState = {
  executionId: string
  flowId: string
  dataChain: DataChain
  flow: any
}

// ============ Steps ============

/**
 * Step 1: Load and validate the flow
 */
const loadFlowStep = createStep(
  "load-flow-step",
  async (input: { flowId: string }, { container }) => {
    const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)
    
    const flow = await service.getFlowWithDetails(input.flowId)
    
    if (!flow) {
      throw new Error(`Flow '${input.flowId}' not found`)
    }
    
    if (flow.status !== "active") {
      throw new Error(`Flow '${input.flowId}' is not active (status: ${flow.status})`)
    }
    
    return new StepResponse(flow)
  }
)

/**
 * Step 2: Create execution record and initialize data chain
 */
const initializeExecutionStep = createStep(
  "initialize-execution-step",
  async (
    input: { 
      flowId: string
      flow: any
      triggerData: Record<string, any>
      triggeredBy?: string
      metadata?: Record<string, any>
    }, 
    { container }
  ) => {
    const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)
    
    // Initialize data chain
    const dataChain: DataChain = {
      $trigger: {
        payload: input.triggerData,
        event: input.flow.trigger_config?.event,
        timestamp: new Date().toISOString(),
      },
      $accountability: {
        triggered_by: input.triggeredBy,
      },
      $env: getAllowedEnvVars(),
      $last: null,
    }
    
    // Create execution record
    const execution = await service.createExecution({
      flow_id: input.flowId,
      trigger_data: input.triggerData,
      triggered_by: input.triggeredBy,
      metadata: input.metadata,
    })
    
    // Update to running status
    await service.updateExecutionStatus(execution.id, "running", {
      data_chain: dataChain,
    })
    
    // Log trigger
    await service.addExecutionLog({
      execution_id: execution.id,
      operation_key: "$trigger",
      status: "success",
      input_data: input.triggerData,
      output_data: dataChain.$trigger,
      duration_ms: 0,
    })
    
    return new StepResponse(
      { executionId: execution.id, dataChain },
      execution.id // For compensation
    )
  },
  // Compensation: mark execution as cancelled
  async (executionId: string, { container }) => {
    const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)
    await service.updateExecutionStatus(executionId, "cancelled", {
      error: "Workflow cancelled during execution",
      completed_at: new Date(),
    })
  }
)

/**
 * Step 3: Execute all operations in the flow
 */
const executeOperationsStep = createStep(
  "execute-operations-step",
  async (
    input: {
      executionId: string
      flowId: string
      flow: any
      dataChain: DataChain
    },
    { container }
  ) => {
    const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)
    
    const dataChain = { ...input.dataChain }
    
    // Get canvas state for node-to-operation mapping
    const canvasState = input.flow.canvas_state || { nodes: [], edges: [] }
    const canvasNodes = canvasState.nodes || []
    const canvasEdges = canvasState.edges || []
    
    // Build a map from canvas node ID to operation data
    // Canvas nodes have id like "op_1765170602021" and data.operationKey like "read_data_1765170602021"
    const nodeIdToOperation: Map<string, any> = new Map()
    
    for (const node of canvasNodes) {
      if (node.id === "trigger") continue // Skip trigger node
      
      // The node data contains operationType and operationKey
      const nodeData = node.data || {}
      nodeIdToOperation.set(node.id, {
        id: node.id, // Use canvas node ID for graph traversal
        operation_key: nodeData.operationKey || node.id,
        operation_type: nodeData.operationType || "unknown",
        name: nodeData.label || nodeData.operationKey,
        options: nodeData.options || {},
        position_x: node.position?.x || 0,
        position_y: node.position?.y || 0,
        sort_order: 0, // Will be determined by execution order
      })
    }
    
    // Build connections from canvas edges
    const connections = canvasEdges.map((edge: any) => ({
      source_id: edge.source,
      target_id: edge.target,
      source_handle: edge.sourceHandle || "default",
      target_handle: edge.targetHandle || "default",
      connection_type: "default",
    }))
    
    // Convert map to array for operations
    const operations = Array.from(nodeIdToOperation.values())
    
    // Find starting operations (connected from trigger)
    const triggerConnections = connections.filter((c: any) => c.source_id === "trigger")
    const startingOpIds = new Set(triggerConnections.map((c: any) => c.target_id))
    const startingOps = operations.filter((op: any) => startingOpIds.has(op.id))
    
    console.log("[execute-visual-flow] Starting operations:", startingOps.map((o: any) => o.operation_key))
    console.log("[execute-visual-flow] All operations:", operations.map((o: any) => ({ id: o.id, key: o.operation_key })))
    console.log("[execute-visual-flow] Connections:", connections)
    
    // Execute operations recursively
    await executeOperationsRecursive(
      startingOps,
      operations,
      connections,
      dataChain,
      input.executionId,
      input.flowId,
      container,
      service
    )
    
    return new StepResponse({ dataChain, success: true })
  }
)

/**
 * Step 4: Complete the execution
 */
const completeExecutionStep = createStep(
  "complete-execution-step",
  async (
    input: {
      executionId: string
      dataChain: DataChain
      success: boolean
      error?: string
    },
    { container }
  ) => {
    const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)
    
    if (input.success) {
      await service.updateExecutionStatus(input.executionId, "completed", {
        data_chain: input.dataChain,
        completed_at: new Date(),
      })
    } else {
      await service.updateExecutionStatus(input.executionId, "failed", {
        data_chain: input.dataChain,
        error: input.error,
        completed_at: new Date(),
      })
    }
    
    return new StepResponse({
      executionId: input.executionId,
      status: input.success ? "completed" : "failed",
      dataChain: input.dataChain,
      error: input.error,
    })
  }
)

// ============ Helper Functions ============

/**
 * Recursively execute operations following the connection graph
 */
async function executeOperationsRecursive(
  currentOps: any[],
  allOperations: any[],
  connections: any[],
  dataChain: DataChain,
  executionId: string,
  flowId: string,
  container: any,
  service: VisualFlowService
): Promise<void> {
  // Sort by position (top to bottom, left to right)
  const sortedOps = [...currentOps].sort((a, b) => {
    if (a.position_y !== b.position_y) return a.position_y - b.position_y
    return a.position_x - b.position_x
  })

  console.log("[execute-visual-flow] Executing operations:", sortedOps.map((o: any) => o.operation_key))

  for (const operation of sortedOps) {
    console.log(`[execute-visual-flow] Executing: ${operation.operation_key} (${operation.operation_type})`)
    
    // Execute the operation
    const result = await executeSingleOperation(
      operation,
      dataChain,
      executionId,
      flowId,
      container,
      service
    )

    console.log(`[execute-visual-flow] Result for ${operation.operation_key}:`, result?.success ? "success" : "failed")

    // Find next operations based on result
    const nextOps = findNextOperations(
      operation,
      result,
      allOperations,
      connections
    )

    console.log(`[execute-visual-flow] Next operations after ${operation.operation_key}:`, nextOps.map((o: any) => o.operation_key))

    // Recursively execute next operations
    if (nextOps.length > 0) {
      await executeOperationsRecursive(
        nextOps,
        allOperations,
        connections,
        dataChain,
        executionId,
        flowId,
        container,
        service
      )
    }
  }
}

/**
 * Execute a single operation
 */
async function executeSingleOperation(
  operation: any,
  dataChain: DataChain,
  executionId: string,
  flowId: string,
  container: any,
  service: VisualFlowService
): Promise<any> {
  const handler = operationRegistry.get(operation.operation_type)
  
  if (!handler) {
    throw new Error(`Unknown operation type: ${operation.operation_type}`)
  }

  // Create operation context
  const context: OperationContext = {
    container,
    dataChain,
    flowId,
    executionId,
    operationId: operation.id,
    operationKey: operation.operation_key,
  }

  // Interpolate variables in options
  const resolvedOptions = interpolateVariables(operation.options || {}, dataChain)

  // Log operation start - use null for operation_id since we're using canvas node IDs
  await service.addExecutionLog({
    execution_id: executionId,
    operation_key: operation.operation_key,
    status: "running",
    input_data: resolvedOptions,
  })

  const startTime = Date.now()

  try {
    // Execute the operation
    const result = await handler.execute(resolvedOptions, context)
    const duration = Date.now() - startTime

    if (result.success) {
      // Update data chain
      dataChain[operation.operation_key] = result.data
      dataChain.$last = result.data

      // Log success
      await service.addExecutionLog({
        execution_id: executionId,
        operation_key: operation.operation_key,
        status: "success",
        input_data: resolvedOptions,
        output_data: result.data,
        duration_ms: duration,
      })

      return result
    } else {
      // Log failure
      await service.addExecutionLog({
        execution_id: executionId,
        operation_key: operation.operation_key,
        status: "failure",
        input_data: resolvedOptions,
        error: result.error,
        error_stack: result.errorStack,
        duration_ms: duration,
      })

      throw new Error(result.error || "Operation failed")
    }
  } catch (error: any) {
    const duration = Date.now() - startTime

    // Log failure
    await service.addExecutionLog({
      execution_id: executionId,
      operation_key: operation.operation_key,
      status: "failure",
      input_data: resolvedOptions,
      error: error.message,
      error_stack: error.stack,
      duration_ms: duration,
    })

    throw error
  }
}

/**
 * Find next operations based on connections and result
 */
function findNextOperations(
  currentOp: any,
  result: any,
  allOperations: any[],
  connections: any[]
): any[] {
  // Get connections from this operation
  const outgoingConnections = connections.filter((c: any) => c.source_id === currentOp.id)

  if (outgoingConnections.length === 0) {
    return []
  }

  // For condition operations, filter by branch
  if (currentOp.operation_type === "condition" && result?.data?._branch) {
    const branch = result.data._branch // "success" or "failure"
    const matchingConnections = outgoingConnections.filter(
      (c: any) => c.connection_type === branch || c.source_handle === branch
    )
    const nextOpIds = matchingConnections.map((c: any) => c.target_id)
    return allOperations.filter((op: any) => nextOpIds.includes(op.id))
  }

  // For other operations, follow all connections
  const nextOpIds = outgoingConnections.map((c: any) => c.target_id)
  return allOperations.filter((op: any) => nextOpIds.includes(op.id))
}

// ============ Workflow ============

/**
 * Workflow to execute a visual flow
 * 
 * Steps:
 * 1. Load and validate the flow
 * 2. Create execution record and initialize data chain
 * 3. Execute all operations following the graph
 * 4. Complete the execution (success or failure)
 * 
 * Benefits over direct execution:
 * - Automatic compensation on failure
 * - Workflow execution tracking
 * - Can be composed with other workflows
 * - Supports async/long-running operations in the future
 */
export const executeVisualFlowWorkflow = createWorkflow(
  {
    name: "execute-visual-flow",
    store: true, // Store execution for tracking
  },
  (input: ExecuteVisualFlowInput) => {
    // Step 1: Load flow
    const flow = loadFlowStep({ flowId: input.flowId })
    
    // Step 2: Initialize execution
    const execution = initializeExecutionStep({
      flowId: input.flowId,
      flow,
      triggerData: input.triggerData || {},
      triggeredBy: input.triggeredBy,
      metadata: input.metadata,
    })
    
    // Step 3: Execute operations
    const operationsResult = executeOperationsStep({
      executionId: execution.executionId,
      flowId: input.flowId,
      flow,
      dataChain: execution.dataChain,
    })
    
    // Step 4: Complete execution
    const result = completeExecutionStep({
      executionId: execution.executionId,
      dataChain: operationsResult.dataChain,
      success: operationsResult.success,
    })
    
    return new WorkflowResponse(result)
  }
)

export default executeVisualFlowWorkflow
