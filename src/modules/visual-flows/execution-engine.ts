import { MedusaContainer } from "@medusajs/framework/types"
import { 
  DataChain, 
  OperationContext, 
  operationRegistry,
  getAllowedEnvVars,
  interpolateVariables,
} from "./operations"
import VisualFlowService from "./service"
import { VISUAL_FLOWS_MODULE } from "./index"

interface ExecutionOptions {
  triggeredBy?: string
  metadata?: Record<string, any>
}

interface ExecutionResult {
  executionId: string
  status: "completed" | "failed"
  dataChain: DataChain
  error?: string
}

/**
 * Execution engine for visual flows
 * Converts visual flow definitions to runtime execution
 */
export class FlowExecutionEngine {
  private container: MedusaContainer
  private flowService: VisualFlowService

  constructor(container: MedusaContainer) {
    this.container = container
    this.flowService = container.resolve(VISUAL_FLOWS_MODULE)
  }

  /**
   * Execute a flow with the given trigger data
   */
  async execute(
    flowId: string, 
    triggerData: any = {},
    options: ExecutionOptions = {}
  ): Promise<ExecutionResult> {
    // 1. Load flow definition
    const flow = await this.flowService.getFlowWithDetails(flowId)
    
    if (!flow) {
      throw new Error(`Flow '${flowId}' not found`)
    }
    
    if (flow.status !== "active") {
      throw new Error(`Flow '${flowId}' is not active (status: ${flow.status})`)
    }

    // 2. Initialize data chain
    const dataChain: DataChain = {
      $trigger: {
        payload: triggerData,
        event: (flow.trigger_config as any)?.event,
        timestamp: new Date().toISOString(),
      },
      $accountability: {
        triggered_by: options.triggeredBy,
      },
      $env: getAllowedEnvVars(),
      $last: null,
    }

    // 3. Create execution record
    const execution = await this.flowService.createExecution({
      flow_id: flowId,
      trigger_data: triggerData,
      triggered_by: options.triggeredBy,
      metadata: options.metadata,
    })

    // Update execution to running
    await this.flowService.updateExecutionStatus(execution.id, "running", {
      data_chain: dataChain,
    })

    // Log trigger
    await this.flowService.addExecutionLog({
      execution_id: execution.id,
      operation_key: "$trigger",
      status: "success",
      input_data: triggerData,
      output_data: dataChain.$trigger,
      duration_ms: 0,
    })

    try {
      // 4. Build execution graph
      const operations = flow.operations || []
      const connections = flow.connections || []
      
      // Find starting operations (connected from trigger)
      const startingOps = this.findStartingOperations(operations, connections)
      
      // 5. Execute operations in order
      await this.executeOperations(
        startingOps,
        operations,
        connections,
        dataChain,
        execution.id,
        flowId
      )

      // 6. Mark execution as completed
      await this.flowService.updateExecutionStatus(execution.id, "completed", {
        data_chain: dataChain,
        completed_at: new Date(),
      })

      return {
        executionId: execution.id,
        status: "completed",
        dataChain,
      }
    } catch (error: any) {
      // Mark execution as failed
      await this.flowService.updateExecutionStatus(execution.id, "failed", {
        data_chain: dataChain,
        error: error.message,
        error_details: { stack: error.stack },
        completed_at: new Date(),
      })

      return {
        executionId: execution.id,
        status: "failed",
        dataChain,
        error: error.message,
      }
    }
  }

  /**
   * Find operations that are connected from the trigger
   */
  private findStartingOperations(
    operations: any[],
    connections: any[]
  ): any[] {
    const triggerConnections = connections.filter(c => c.source_id === "trigger")
    const startingOpIds = new Set(triggerConnections.map(c => c.target_id))
    return operations.filter(op => startingOpIds.has(op.id))
  }

  /**
   * Execute operations following the connection graph
   */
  private async executeOperations(
    currentOps: any[],
    allOperations: any[],
    connections: any[],
    dataChain: DataChain,
    executionId: string,
    flowId: string
  ): Promise<void> {
    // Sort by sort_order
    const sortedOps = [...currentOps].sort((a, b) => a.sort_order - b.sort_order)

    for (const operation of sortedOps) {
      // Execute the operation
      const result = await this.executeOperation(
        operation,
        dataChain,
        executionId,
        flowId
      )

      // Find next operations based on result
      const nextOps = this.findNextOperations(
        operation,
        result,
        allOperations,
        connections
      )

      // Recursively execute next operations
      if (nextOps.length > 0) {
        await this.executeOperations(
          nextOps,
          allOperations,
          connections,
          dataChain,
          executionId,
          flowId
        )
      }
    }
  }

  /**
   * Execute a single operation
   */
  private async executeOperation(
    operation: any,
    dataChain: DataChain,
    executionId: string,
    flowId: string
  ): Promise<any> {
    const handler = operationRegistry.get(operation.operation_type)
    
    if (!handler) {
      throw new Error(`Unknown operation type: ${operation.operation_type}`)
    }

    // Create operation context
    const context: OperationContext = {
      container: this.container,
      dataChain,
      flowId,
      executionId,
      operationId: operation.id,
      operationKey: operation.operation_key,
    }

    // Interpolate variables in options
    const resolvedOptions = interpolateVariables(operation.options || {}, dataChain)

    // Log operation start
    await this.flowService.addExecutionLog({
      execution_id: executionId,
      operation_id: operation.id,
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
        await this.flowService.addExecutionLog({
          execution_id: executionId,
          operation_id: operation.id,
          operation_key: operation.operation_key,
          status: "success",
          input_data: resolvedOptions,
          output_data: result.data,
          duration_ms: duration,
        })

        return result
      } else {
        // Log failure
        await this.flowService.addExecutionLog({
          execution_id: executionId,
          operation_id: operation.id,
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
      await this.flowService.addExecutionLog({
        execution_id: executionId,
        operation_id: operation.id,
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
  private findNextOperations(
    currentOp: any,
    result: any,
    allOperations: any[],
    connections: any[]
  ): any[] {
    // Get connections from this operation
    const outgoingConnections = connections.filter(c => c.source_id === currentOp.id)

    if (outgoingConnections.length === 0) {
      return []
    }

    // For condition operations, filter by branch
    if (currentOp.operation_type === "condition" && result?.data?._branch) {
      const branch = result.data._branch // "success" or "failure"
      const matchingConnections = outgoingConnections.filter(
        c => c.connection_type === branch || c.source_handle === branch
      )
      const nextOpIds = matchingConnections.map(c => c.target_id)
      return allOperations.filter(op => nextOpIds.includes(op.id))
    }

    // For other operations, follow all connections
    const nextOpIds = outgoingConnections.map(c => c.target_id)
    return allOperations.filter(op => nextOpIds.includes(op.id))
  }
}

/**
 * Create an execution engine instance
 */
export function createExecutionEngine(container: MedusaContainer): FlowExecutionEngine {
  return new FlowExecutionEngine(container)
}
