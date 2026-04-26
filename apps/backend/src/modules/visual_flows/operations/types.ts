import { MedusaContainer } from "@medusajs/framework/types"
import { z } from "@medusajs/framework/zod"

/**
 * Data chain that accumulates data as the flow executes
 */
export interface DataChain {
  $trigger: {
    payload: any
    event?: string
    timestamp: string
  }
  $accountability: {
    user_id?: string
    role?: string
    ip?: string
    triggered_by?: string
  }
  $env: Record<string, string>
  $last: any
  [operationKey: string]: any
}

/**
 * Context passed to operation handlers
 */
export interface OperationContext {
  container: MedusaContainer
  dataChain: DataChain
  flowId: string
  executionId: string
  operationId: string
  operationKey: string
}

/**
 * Result of an operation execution
 */
export interface OperationResult {
  success: boolean
  data?: any
  error?: string
  errorStack?: string
}

/**
 * Definition of an operation type
 */
export interface OperationDefinition {
  /** Unique type identifier */
  type: string
  
  /** Display name */
  name: string
  
  /** Description for UI */
  description: string
  
  /** Icon identifier (from @medusajs/icons or custom) */
  icon: string
  
  /** Category for grouping in UI */
  category: "data" | "logic" | "communication" | "integration" | "utility"
  
  /** Zod schema for options validation and UI generation */
  optionsSchema: z.ZodSchema
  
  /** Default options */
  defaultOptions?: Record<string, any>
  
  /** Whether this operation can have multiple outputs (like condition) */
  hasMultipleOutputs?: boolean
  
  /** Output handles if hasMultipleOutputs is true */
  outputHandles?: Array<{
    id: string
    label: string
    type: "success" | "failure" | "default"
  }>
  
  /** Execute the operation */
  execute: (options: any, context: OperationContext) => Promise<OperationResult>
}

/**
 * Operation registry for managing available operations
 */
export class OperationRegistry {
  private operations: Map<string, OperationDefinition> = new Map()

  register(operation: OperationDefinition): void {
    this.operations.set(operation.type, operation)
  }

  get(type: string): OperationDefinition | undefined {
    return this.operations.get(type)
  }

  getAll(): OperationDefinition[] {
    return Array.from(this.operations.values())
  }

  getByCategory(category: string): OperationDefinition[] {
    return this.getAll().filter(op => op.category === category)
  }

  has(type: string): boolean {
    return this.operations.has(type)
  }

  /**
   * Get operation definitions for UI (without execute function)
   */
  getDefinitionsForUI(): Array<Omit<OperationDefinition, "execute">> {
    return this.getAll().map(({ execute, ...rest }) => rest)
  }
}

// Global registry instance
export const operationRegistry = new OperationRegistry()
