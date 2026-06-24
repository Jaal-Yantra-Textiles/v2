import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import type { IEventBusModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { VISUAL_FLOWS_MODULE } from "../../modules/visual_flows"
import VisualFlowService from "../../modules/visual_flows/service"
import { describeFetchError } from "../../utils/describe-fetch-error"
import {
  operationRegistry,
  DataChain,
  OperationContext,
  getAllowedEnvVars,
  interpolateVariables,
} from "../../modules/visual_flows/operations"

/**
 * Lifecycle event emit helper.
 *
 * Why a helper: the execution workflow lives downstream of the event
 * bus on the boot graph, so we resolve lazily. A missing or
 * misconfigured event bus must never be the reason a real execution
 * (or its compensation) fails — observability is strictly additive
 * here. Errors are swallowed because the execution row + log table
 * still hold the truth even if the email never goes out.
 */
async function emitFlowLifecycleEvent(
  container: any,
  name: "visual_flow_execution.started" | "visual_flow_execution.failed",
  data: Record<string, any>
) {
  try {
    const eventBus = container.resolve(Modules.EVENT_BUS) as IEventBusModuleService
    await eventBus.emit({ name, data })
  } catch {
    // Intentional: see comment above.
  }
}

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
    
    // Resolve the actual event name. Precedence:
    //   1. metadata.event_name — passed by the event-trigger subscriber, the
    //      only source that knows the concrete event for wildcard listeners.
    //   2. trigger_config.event / event_type — exact-match flow configs.
    // event_pattern is not a name, so we never read it here.
    const incomingEventName =
      (input.metadata as Record<string, any> | undefined)?.event_name ??
      (input.flow.trigger_config as any)?.event ??
      (input.flow.trigger_config as any)?.event_type ??
      undefined

    // Initialize data chain.
    // Spread triggerData at the root of $trigger so users can write
    // {{ $trigger.id }}, {{ $trigger.html_body }}, etc. directly.
    // Also keep .payload for backwards compatibility.
    const dataChain: DataChain = {
      $trigger: {
        ...input.triggerData,
        payload: input.triggerData,
        event: incomingEventName,
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

    // Lifecycle: emit `visual_flow_execution.started` so admins (or
    // any other subscriber) can surface an in-progress flow. Until
    // this hook existed, executions only became visible to admins
    // when they completed or failed — long flows had no kick-off
    // signal at all.
    await emitFlowLifecycleEvent(container, "visual_flow_execution.started", {
      flow_id: input.flowId,
      flow_name: (input.flow as any)?.name,
      flow_metadata: (input.flow as any)?.metadata ?? null,
      // trigger_type lets the lifecycle-email subscriber default the
      // start-email OFF for schedule-triggered flows (#418): short-interval
      // schedules were spamming the inbox with kick-off notices.
      flow_trigger_type: (input.flow as any)?.trigger_type ?? null,
      execution_id: execution.id,
      triggered_by: input.triggeredBy,
      triggered_by_event: incomingEventName,
      started_at: new Date().toISOString(),
    })

    // The compensation needs more than `executionId` so it can emit a
    // rich `visual_flow_execution.failed` event (flow name + metadata
    // for recipient resolution; trigger fields for the email body).
    // The execution log table holds the per-operation failure detail
    // and is read at compensation time.
    return new StepResponse(
      { executionId: execution.id, dataChain },
      {
        executionId: execution.id,
        flowId: input.flowId,
        flowName: (input.flow as any)?.name,
        flowMetadata: (input.flow as any)?.metadata ?? null,
        triggeredBy: input.triggeredBy,
        triggeredByEvent: incomingEventName,
      }
    )
  },
  // Compensation: mark execution as cancelled + emit the failure event
  // so admins get an email instead of staring at a silent
  // status=cancelled row. We dig the actual operation-level error out
  // of the execution log because the workflow-engine error is the
  // generic "Workflow cancelled during execution" string, which is
  // exactly the unhelpful surface roadmap item 26 set out to fix.
  async (
    rollbackData:
      | {
          executionId: string
          flowId: string
          flowName?: string
          flowMetadata?: Record<string, any> | null
          triggeredBy?: string
          triggeredByEvent?: string
        }
      | undefined,
    { container }
  ) => {
    if (!rollbackData?.executionId) return
    const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)

    // Pull the most recent failure log row for this execution — the
    // log table is the only place the per-operation error survives
    // once the workflow engine rethrows the generic cancel message.
    let failingOperationKey: string | null = null
    let operationErrorMessage: string | null = null
    try {
      const logs = await (service as any).listVisualFlowExecutionLogs(
        { execution_id: rollbackData.executionId, status: "failure" },
        { take: 1, order: { created_at: "DESC" } }
      )
      const latest = logs?.[0]
      if (latest) {
        failingOperationKey = latest.operation_key ?? null
        operationErrorMessage = latest.error ?? null
      }
    } catch {
      // Best-effort lookup — fall through to a generic event.
    }

    const errorMessage =
      operationErrorMessage ||
      (failingOperationKey
        ? `Operation '${failingOperationKey}' failed`
        : "Workflow cancelled during execution")

    await service.updateExecutionStatus(rollbackData.executionId, "cancelled", {
      error: errorMessage,
      completed_at: new Date(),
    })

    await emitFlowLifecycleEvent(container, "visual_flow_execution.failed", {
      flow_id: rollbackData.flowId,
      flow_name: rollbackData.flowName,
      flow_metadata: rollbackData.flowMetadata ?? null,
      execution_id: rollbackData.executionId,
      triggered_by: rollbackData.triggeredBy,
      triggered_by_event: rollbackData.triggeredByEvent,
      failing_operation_key: failingOperationKey,
      error_message: errorMessage,
      failed_at: new Date().toISOString(),
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

    // Build a lookup from operation_key → DB operation so that canvas nodes
    // created by seed scripts (which don't embed options in their data) still
    // run with the correct options stored in the visual_flow_operation table.
    const dbOpByKey = new Map<string, any>()
    for (const dbOp of (input.flow.operations || [])) {
      dbOpByKey.set(dbOp.operation_key, dbOp)
    }

    // Build a map from canvas node ID to operation data
    // Canvas nodes have id like "op_1765170602021" and data.operationKey like "read_data_1765170602021"
    const nodeIdToOperation: Map<string, any> = new Map()

    for (const node of canvasNodes) {
      if (node.id === "trigger") continue // Skip trigger node

      // The node data contains operationType and operationKey
      const nodeData = node.data || {}
      const opKey = nodeData.operationKey || node.id
      const dbOp = dbOpByKey.get(opKey)

      // Canvas node options take precedence; fall back to DB operation options.
      // This ensures seed scripts (which store options only in the DB) work
      // without needing to embed them inside canvas_state node data.
      const hasCanvasOptions = nodeData.options && Object.keys(nodeData.options).length > 0
      const resolvedOptions = hasCanvasOptions ? nodeData.options : (dbOp?.options || {})

      nodeIdToOperation.set(node.id, {
        id: node.id, // Use canvas node ID for graph traversal
        // Real DB operation id (when this node maps to a stored operation) so
        // execution logs can FK to it and the executions API can resolve the
        // operation name — canvas node ids are not DB ids (#704).
        db_operation_id: dbOp?.id,
        operation_key: opKey,
        operation_type: nodeData.operationType || dbOp?.operation_type || "unknown",
        name: nodeData.label || opKey,
        options: resolvedOptions,
        position_x: node.position?.x || 0,
        position_y: node.position?.y || 0,
        sort_order: 0, // Will be determined by execution order
      })
    }

    // Build connections from canvas edges.
    // Also synthesise a trigger→first-op connection when the canvas was seeded
    // without an explicit trigger node/edge (seed scripts often omit it).
    const connections = canvasEdges.map((edge: any) => ({
      source_id: edge.source,
      target_id: edge.target,
      source_handle: edge.sourceHandle || "default",
      target_handle: edge.targetHandle || "default",
      connection_type:
        edge.sourceHandle === "success" || edge.sourceHandle === "failure"
          ? edge.sourceHandle
          : "default",
    }))

    // If no trigger connection exists, find the topologically first operation
    // (one that has no incoming edges from other operations) and treat it as
    // the implicit entry point — identical to connecting it from the trigger.
    const hasTriggerConnection = connections.some((c: any) => c.source_id === "trigger")
    if (!hasTriggerConnection && connections.length > 0) {
      const targetIds = new Set(connections.map((c: any) => c.target_id))
      const nodeIds = Array.from(nodeIdToOperation.keys())
      const roots = nodeIds.filter(id => !targetIds.has(id))
      for (const rootId of roots) {
        connections.push({
          source_id: "trigger",
          target_id: rootId,
          source_handle: "default",
          target_handle: "default",
          connection_type: "default",
        })
      }
    }
    
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
 * Recursively execute operations following the connection graph.
 *
 * A `visited` set (keyed by canvas node id) guards every node so it runs **at
 * most once per execution**. This fixes two correctness bugs in the prior
 * un-guarded traversal:
 *   1. Diamond graphs (A→B→D, A→C→D) double-executed the join node `D` — once
 *      down each branch — re-sending emails / re-writing data.
 *   2. An accidental cycle (A→B→A) infinite-looped the executor (and the worker).
 * Linear and simple-branch flows are unaffected (each node is reached once
 * anyway). True fan-in *join* semantics (waiting for every parent before running
 * D) are a separate concern handled by the compiled-plan level driver (#459
 * slice 3); this guard only removes the double-run / infinite-loop hazards.
 *
 * `execOp` is injectable so the traversal can be unit-tested without a container.
 *
 * @internal exported for unit testing only.
 */
export async function executeOperationsRecursive(
  currentOps: any[],
  allOperations: any[],
  connections: any[],
  dataChain: DataChain,
  executionId: string,
  flowId: string,
  container: any,
  service: VisualFlowService,
  visited: Set<string> = new Set<string>(),
  execOp: typeof executeSingleOperation = executeSingleOperation
): Promise<void> {
  // Sort by position (top to bottom, left to right)
  const sortedOps = [...currentOps].sort((a, b) => {
    if (a.position_y !== b.position_y) return a.position_y - b.position_y
    return a.position_x - b.position_x
  })

  console.log("[execute-visual-flow] Executing operations:", sortedOps.map((o: any) => o.operation_key))

  for (const operation of sortedOps) {
    // Skip nodes already executed in this run (diamond join / cycle guard).
    if (visited.has(operation.id)) {
      console.log(`[execute-visual-flow] Skipping already-executed: ${operation.operation_key}`)
      continue
    }
    visited.add(operation.id)

    console.log(`[execute-visual-flow] Executing: ${operation.operation_key} (${operation.operation_type})`)

    // Execute the operation
    const result = await execOp(
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
        service,
        visited,
        execOp
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

  // Pre-resolve options only for logging — operations do their own interpolation
  // internally so they can access per-item context ($item, $index, etc.).
  // Passing raw options prevents double-interpolation killing templates like
  // {{ item.name }} before the operation's own loop runs.
  const rawOptions = operation.options || {}
  const resolvedOptionsForLog = interpolateVariables(rawOptions, dataChain)

  // Real DB operation id for this node (when it maps to a stored operation), so
  // logs FK to the operation and the executions API can resolve its name —
  // previously left null because canvas node ids aren't DB ids (#704).
  const dbOperationId: string | undefined = operation.db_operation_id

  // Log operation start
  await service.addExecutionLog({
    execution_id: executionId,
    operation_id: dbOperationId,
    operation_key: operation.operation_key,
    status: "running",
    input_data: resolvedOptionsForLog,
  })

  const startTime = Date.now()

  try {
    // Execute the operation with raw options so each operation controls its own interpolation
    const result = await handler.execute(rawOptions, context)
    const duration = Date.now() - startTime

    if (result.success) {
      // Update data chain
      dataChain[operation.operation_key] = result.data
      dataChain.$last = result.data

      // Log success
      await service.addExecutionLog({
        execution_id: executionId,
        operation_id: dbOperationId,
        operation_key: operation.operation_key,
        status: "success",
        input_data: resolvedOptionsForLog,
        output_data: result.data,
        duration_ms: duration,
      })

      return result
    } else {
      // Log failure
      await service.addExecutionLog({
        execution_id: executionId,
        operation_id: dbOperationId,
        operation_key: operation.operation_key,
        status: "failure",
        input_data: resolvedOptionsForLog,
        error: result.error,
        error_stack: result.errorStack,
        duration_ms: duration,
      })

      throw new Error(result.error || "Operation failed")
    }
  } catch (error: any) {
    const duration = Date.now() - startTime

    // Unwrap undici's opaque "fetch failed" into the real network cause
    // (connect ETIMEDOUT / ECONNRESET / DNS) so the failure log says WHY —
    // the WhatsApp notify_partner incident stored a bare "fetch failed" (#704).
    // describeFetchError falls back to error.message for non-fetch errors.
    const errorDetail = describeFetchError(error)

    // Log failure
    await service.addExecutionLog({
      execution_id: executionId,
      operation_id: dbOperationId,
      operation_key: operation.operation_key,
      status: "failure",
      input_data: resolvedOptionsForLog,
      error: errorDetail,
      error_stack: error.stack,
      duration_ms: duration,
    })

    throw error
  }
}

/**
 * Find next operations based on connections and result.
 * @internal exported for unit testing only.
 */
export function findNextOperations(
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
