import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../../lib/config"
import { queryKeysFactory } from "../../lib/query-key-factory"

// Query keys
const VISUAL_FLOWS_QUERY_KEY = "visual_flows" as const
export const visualFlowQueryKeys = queryKeysFactory(VISUAL_FLOWS_QUERY_KEY)

// Types
export interface VisualFlow {
  id: string
  name: string
  description: string | null
  status: "active" | "inactive" | "draft"
  icon: string | null
  color: string | null
  trigger_type: "event" | "schedule" | "webhook" | "manual" | "another_flow"
  trigger_config: Record<string, any>
  canvas_state: {
    nodes: any[]
    edges: any[]
    viewport: { x: number; y: number; zoom: number }
  }
  metadata: Record<string, any>
  operations?: VisualFlowOperation[]
  connections?: VisualFlowConnection[]
  created_at: string
  updated_at: string
}

export interface VisualFlowOperation {
  id: string
  flow_id: string
  operation_key: string
  operation_type: string
  name: string | null
  options: Record<string, any>
  position_x: number
  position_y: number
  sort_order: number
}

export interface VisualFlowConnection {
  id: string
  flow_id: string
  source_id: string
  source_handle: string
  target_id: string
  target_handle: string
  connection_type: "success" | "failure" | "default"
  condition: Record<string, any> | null
  label: string | null
  style: Record<string, any> | null
}

// Input types for create/update (without server-generated fields)
export interface VisualFlowOperationInput {
  id?: string
  operation_key: string
  operation_type: string
  name?: string | null
  options?: Record<string, any>
  position_x: number
  position_y: number
  sort_order: number
}

export interface VisualFlowConnectionInput {
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

export interface VisualFlowUpdateInput {
  name?: string
  description?: string | null
  status?: "active" | "inactive" | "draft"
  trigger_type?: "event" | "schedule" | "webhook" | "manual" | "another_flow"
  trigger_config?: Record<string, any>
  canvas_state?: {
    nodes: any[]
    edges: any[]
    viewport: { x: number; y: number; zoom: number }
  }
  operations?: VisualFlowOperationInput[]
  connections?: VisualFlowConnectionInput[]
  metadata?: Record<string, any>
}

export interface VisualFlowExecution {
  id: string
  flow_id: string
  status: "pending" | "running" | "completed" | "failed" | "cancelled"
  trigger_data: Record<string, any>
  data_chain: Record<string, any>
  started_at: string | null
  completed_at: string | null
  error: string | null
  triggered_by: string | null
  logs?: VisualFlowExecutionLog[]
}

export interface VisualFlowExecutionLog {
  id: string
  execution_id: string
  operation_id: string | null
  operation_key: string
  status: "success" | "failure" | "skipped" | "running"
  input_data: Record<string, any> | null
  output_data: Record<string, any> | null
  error: string | null
  duration_ms: number | null
  executed_at: string
}

export interface OperationDefinition {
  type: string
  name: string
  description: string
  icon: string
  category: "data" | "logic" | "communication" | "integration" | "utility"
  optionsSchema: any
  defaultOptions?: Record<string, any>
  hasMultipleOutputs?: boolean
  outputHandles?: Array<{
    id: string
    label: string
    type: "success" | "failure" | "default"
  }>
}

// Query keys
const VISUAL_FLOWS_KEY = ["visual-flows"]
const VISUAL_FLOW_KEY = (id: string) => ["visual-flows", id]
const VISUAL_FLOW_EXECUTIONS_KEY = (id: string) => ["visual-flows", id, "executions"]
const VISUAL_FLOW_EXECUTION_KEY = (id: string, executionId: string) => ["visual-flows", id, "executions", executionId]
const OPERATIONS_KEY = ["visual-flows", "operations"]

// Hooks

/**
 * List visual flows
 */
export function useVisualFlows(params?: {
  status?: string
  trigger_type?: string
  limit?: number
  offset?: number
  q?: string
}) {
  return useQuery({
    queryKey: [...VISUAL_FLOWS_KEY, params],
    queryFn: async () => {
      const response = await sdk.client.fetch<{
        flows: VisualFlow[]
        count: number
      }>("/admin/visual-flows", {
        method: "GET",
        query: params,
      })
      return response
    },
  })
}

/**
 * Get a single visual flow
 */
export function useVisualFlow(id: string) {
  return useQuery({
    queryKey: VISUAL_FLOW_KEY(id),
    queryFn: async () => {
      const response = await sdk.client.fetch<{ flow: VisualFlow }>(
        `/admin/visual-flows/${id}`
      )
      return response.flow
    },
    enabled: !!id,
  })
}

/**
 * Create a visual flow
 */
export function useCreateVisualFlow() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (data: {
      name: string
      description?: string
      status?: "active" | "inactive" | "draft"
      trigger_type: "event" | "schedule" | "webhook" | "manual" | "another_flow"
      trigger_config?: Record<string, any>
      canvas_state?: Record<string, any>
      operations?: any[]
      connections?: any[]
    }) => {
      const response = await sdk.client.fetch<{ flow: VisualFlow }>(
        "/admin/visual-flows",
        {
          method: "POST",
          body: data,
        }
      )
      return response.flow
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: VISUAL_FLOWS_KEY })
    },
  })
}

/**
 * Update a visual flow
 */
export function useUpdateVisualFlow(id: string) {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (data: VisualFlowUpdateInput) => {
      const response = await sdk.client.fetch<{ flow: VisualFlow }>(
        `/admin/visual-flows/${id}`,
        {
          method: "PUT",
          body: data,
        }
      )
      return response.flow
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: VISUAL_FLOW_KEY(id) })
      queryClient.invalidateQueries({ queryKey: VISUAL_FLOWS_KEY })
    },
  })
}

/**
 * Delete a visual flow
 */
export function useDeleteVisualFlow() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (id: string) => {
      await sdk.client.fetch(`/admin/visual-flows/${id}`, {
        method: "DELETE",
      })
      return id
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: VISUAL_FLOWS_KEY })
    },
  })
}

/**
 * Duplicate a visual flow
 */
export function useDuplicateVisualFlow() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name?: string }) => {
      const response = await sdk.client.fetch<{ flow: VisualFlow }>(
        `/admin/visual-flows/${id}/duplicate`,
        {
          method: "POST",
          body: { name },
        }
      )
      return response.flow
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: VISUAL_FLOWS_KEY })
    },
  })
}

/**
 * Execute a visual flow
 */
export function useExecuteVisualFlow(id: string) {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (data?: {
      trigger_data?: Record<string, any>
      metadata?: Record<string, any>
    }) => {
      const response = await sdk.client.fetch<{
        execution_id: string
        status: string
        error?: string
      }>(`/admin/visual-flows/${id}/execute`, {
        method: "POST",
        body: data || {},
      })
      return response
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: VISUAL_FLOW_EXECUTIONS_KEY(id) })
    },
  })
}

/**
 * List executions for a flow
 */
export function useVisualFlowExecutions(
  flowId: string,
  params?: {
    status?: string
    limit?: number
    offset?: number
  }
) {
  return useQuery({
    queryKey: [...VISUAL_FLOW_EXECUTIONS_KEY(flowId), params],
    queryFn: async () => {
      const response = await sdk.client.fetch<{
        executions: VisualFlowExecution[]
        count: number
      }>(`/admin/visual-flows/${flowId}/executions`, {
        method: "GET",
        query: params,
      })
      return response
    },
    enabled: !!flowId,
  })
}

/**
 * Get a single execution with logs
 */
export function useVisualFlowExecution(flowId: string, executionId: string) {
  return useQuery({
    queryKey: VISUAL_FLOW_EXECUTION_KEY(flowId, executionId),
    queryFn: async () => {
      const response = await sdk.client.fetch<{
        execution: VisualFlowExecution
      }>(`/admin/visual-flows/${flowId}/executions/${executionId}`)
      return response.execution
    },
    enabled: !!flowId && !!executionId,
  })
}

/**
 * Get available operations
 */
export function useOperationDefinitions() {
  return useQuery({
    queryKey: OPERATIONS_KEY,
    queryFn: async () => {
      const response = await sdk.client.fetch<{
        operations: OperationDefinition[]
        grouped: Record<string, OperationDefinition[]>
        categories: string[]
      }>("/admin/visual-flows/operations")
      return response
    },
    staleTime: Infinity, // Operations don't change at runtime
  })
}

// Metadata types
export interface FieldMetadata {
  name: string
  type: string
  required?: boolean
  filterable?: boolean
}

export interface EntityMetadata {
  name: string
  type: "core" | "custom"
  description: string
  queryable: boolean
  moduleName?: string
  fields?: FieldMetadata[]
}

export interface WorkflowMetadata {
  name: string
  description: string
  category: string
  steps?: string[]
  requiredModules?: string[]
  optionalModules?: string[]
  isScheduled?: boolean
  inputSchema?: Record<string, any>
}

export interface EventMetadata {
  name: string
  description: string
  category: string
  payload?: string[]
  subscriberCount?: number
}

export interface TriggerableFlow {
  id: string
  name: string
  description?: string
  trigger_type: string
  status: string
}

export interface FlowMetadata {
  entities: EntityMetadata[]
  workflows: WorkflowMetadata[]
  events?: EventMetadata[]
  triggerableFlows?: TriggerableFlow[]
  dataChainVariables: { name: string; description: string }[]
  interpolationSyntax: {
    variable: string
    nested: string
    expression: string
  }
}

const METADATA_KEY = ["visual-flows", "metadata"] as const

/**
 * Get flow metadata (entities, workflows, etc.)
 */
export function useFlowMetadata() {
  return useQuery({
    queryKey: METADATA_KEY,
    queryFn: async () => {
      const response = await sdk.client.fetch<FlowMetadata>("/admin/visual-flows/metadata")
      return response
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  })
}
