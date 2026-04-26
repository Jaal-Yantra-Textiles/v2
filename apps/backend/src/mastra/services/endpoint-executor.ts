/**
 * Endpoint Executor Service
 *
 * Executes operations via API endpoints instead of direct service calls.
 * This provides better flexibility and consistency with external integrations.
 *
 * Phase 5 Enhancement: API endpoint-based execution approach
 */

// @ts-nocheck
import {
  getRoutesForModule,
  findRoutesForWorkflow,
  entityToModuleName,
  ParsedRoute,
  parseAllRoutes,
} from "./route-parser"
import { queryAdminEndpoints } from "../rag/adminCatalog"
import { planStoreLogger as log } from "./logger"

// ─── Configuration ───────────────────────────────────────────────────────────

// Execution mode: "endpoint" or "service"
export const EXECUTION_MODE = process.env.AI_V3_EXECUTION_MODE || "endpoint"

// Base URL for API calls
const API_BASE_URL = process.env.API_BASE_URL || process.env.BACKEND_URL || "http://localhost:9000"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EndpointMatch {
  endpoint: ParsedRoute
  score: number
  matchType: "exact" | "semantic" | "workflow"
}

export interface EndpointExecutionResult {
  success: boolean
  data: any
  entity: string
  method: string
  statusCode: number
  error?: string
  endpoint?: string
}

export interface AuthHeaders {
  Authorization?: string
  "x-api-key"?: string
  Cookie?: string
}

// ─── Operation to HTTP Method Mapping ───────────────────────────────────────

const OPERATION_TO_METHOD: Record<string, string> = {
  // Read operations
  get: "GET",
  list: "GET",
  fetch: "GET",
  retrieve: "GET",
  find: "GET",
  search: "GET",
  query: "GET",

  // Create operations
  create: "POST",
  add: "POST",
  insert: "POST",
  new: "POST",

  // Update operations
  update: "PATCH",
  edit: "PATCH",
  modify: "PATCH",
  patch: "PATCH",
  put: "PUT",
  replace: "PUT",

  // Delete operations
  delete: "DELETE",
  remove: "DELETE",
  archive: "DELETE",
}

function operationToMethod(operation: string): string {
  const normalized = operation.toLowerCase()
  return OPERATION_TO_METHOD[normalized] || "GET"
}

// ─── Endpoint Discovery ─────────────────────────────────────────────────────

/**
 * Initialize the route parser if not already initialized
 */
async function ensureRoutesLoaded(): Promise<void> {
  try {
    const path = await import("path")
    const apiPath = path.join(process.cwd(), "src", "api")
    await parseAllRoutes(apiPath)
  } catch (error) {
    log.warn("Failed to load routes", { error: String(error) })
  }
}

/**
 * Find the best endpoint for an operation
 */
export async function findBestEndpoint(
  entity: string,
  operation: string,
  filters?: Record<string, any>
): Promise<EndpointMatch | null> {
  log.operationStart("Find Best Endpoint", { entity, operation })

  try {
    await ensureRoutesLoaded()

    const method = operationToMethod(operation)
    const moduleName = entityToModuleName(entity)

    // 1. Check route parser for exact match
    if (moduleName) {
      const routes = getRoutesForModule(moduleName)
      const exactMatch = routes.find(r =>
        r.methods.includes(method as any) &&
        matchesRoutePattern(r, operation, filters)
      )

      if (exactMatch) {
        log.info("Found exact route match", {
          module: moduleName,
          path: exactMatch.path,
          method,
        })
        return { endpoint: exactMatch, score: 1.0, matchType: "exact" }
      }

      // Look for a generic list/retrieve endpoint
      const fallbackRoute = routes.find(r =>
        r.methods.includes(method as any) &&
        (method === "GET" ? isListOrRetrieveEndpoint(r, filters) : true)
      )

      if (fallbackRoute) {
        log.info("Found fallback route match", {
          module: moduleName,
          path: fallbackRoute.path,
          method,
        })
        return { endpoint: fallbackRoute, score: 0.8, matchType: "exact" }
      }
    }

    // 2. Search admin catalog for semantic match
    try {
      const catalogResults = await queryAdminEndpoints(
        `${operation} ${entity}`,
        method,
        5
      )

      if (catalogResults && catalogResults.length > 0) {
        // Convert catalog result to ParsedRoute format
        const catalogMatch = catalogResults[0]
        const route: ParsedRoute = {
          path: catalogMatch.path || catalogMatch.endpoint || "/unknown",
          methods: [method as any],
          module: catalogMatch.module || entity,
          action: operation,
          hasWorkflow: false,
          params: extractParamsFromPath(catalogMatch.path || ""),
        }

        log.info("Found semantic endpoint match", {
          path: route.path,
          similarity: catalogMatch.similarity || catalogMatch.score,
        })

        return {
          endpoint: route,
          score: catalogMatch.similarity || catalogMatch.score || 0.7,
          matchType: "semantic",
        }
      }
    } catch (error) {
      log.warn("Catalog search failed", { error: String(error) })
    }

    log.info("No endpoint match found", { entity, operation })
    return null
  } catch (error) {
    log.error("Failed to find endpoint", { error: String(error) })
    return null
  }
}

/**
 * Check if route matches the operation pattern
 */
function matchesRoutePattern(
  route: ParsedRoute,
  operation: string,
  filters?: Record<string, any>
): boolean {
  const normalizedOperation = operation.toLowerCase()
  const normalizedAction = route.action.toLowerCase()

  // Direct action match
  if (normalizedAction === normalizedOperation) return true

  // Check if route action contains operation
  if (normalizedAction.includes(normalizedOperation)) return true

  // Special cases
  if (normalizedOperation === "list" && normalizedAction === "") return true
  if (normalizedOperation === "get" && normalizedAction === "" && filters?.id) return true

  return false
}

/**
 * Check if route is a list or retrieve endpoint
 */
function isListOrRetrieveEndpoint(route: ParsedRoute, filters?: Record<string, any>): boolean {
  // If filters has an ID, look for retrieve endpoint (with [id] param)
  if (filters?.id) {
    return route.params.includes("id")
  }

  // Otherwise look for list endpoint (no id param)
  return !route.params.includes("id") || route.path.endsWith("/")
}

/**
 * Extract dynamic params from a path
 */
function extractParamsFromPath(path: string): string[] {
  const paramRegex = /\[([^\]]+)\]/g
  const params: string[] = []
  let match

  while ((match = paramRegex.exec(path)) !== null) {
    params.push(match[1])
  }

  return params
}

// ─── Endpoint Execution ─────────────────────────────────────────────────────

/**
 * Build the full URL for an endpoint with parameters
 */
function buildEndpointUrl(
  endpoint: ParsedRoute,
  params: Record<string, any>
): string {
  let url = endpoint.path

  // Replace path parameters
  for (const [key, value] of Object.entries(params)) {
    url = url.replace(`[${key}]`, String(value))
  }

  // Build query string for GET requests with remaining params
  const queryParams: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (!endpoint.params.includes(key) && value !== undefined) {
      if (Array.isArray(value)) {
        queryParams.push(`${key}=${value.join(",")}`)
      } else if (typeof value === "object") {
        queryParams.push(`${key}=${encodeURIComponent(JSON.stringify(value))}`)
      } else {
        queryParams.push(`${key}=${encodeURIComponent(String(value))}`)
      }
    }
  }

  if (queryParams.length > 0) {
    url += `?${queryParams.join("&")}`
  }

  // Ensure the URL starts with /admin if it doesn't already
  if (!url.startsWith("/admin") && !url.startsWith("http")) {
    url = `/admin${url}`
  }

  return `${API_BASE_URL}${url}`
}

/**
 * Execute an operation via HTTP endpoint
 */
export async function executeEndpoint(
  endpoint: EndpointMatch,
  params: Record<string, any>,
  body?: Record<string, any>,
  authHeaders?: AuthHeaders
): Promise<EndpointExecutionResult> {
  const method = endpoint.endpoint.methods[0] || "GET"
  const url = buildEndpointUrl(endpoint.endpoint, params)

  log.operationStart("Execute Endpoint", {
    method,
    url: url.slice(0, 100),
    hasBody: Boolean(body),
  })

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...authHeaders,
    }

    const fetchOptions: RequestInit = {
      method,
      headers,
    }

    // Add body for non-GET requests
    if (body && method !== "GET") {
      fetchOptions.body = JSON.stringify(body)
    }

    const response = await fetch(url, fetchOptions)
    let data: any

    try {
      data = await response.json()
    } catch {
      data = { message: await response.text() }
    }

    const result: EndpointExecutionResult = {
      success: response.ok,
      data,
      entity: endpoint.endpoint.module || "unknown",
      method,
      statusCode: response.status,
      endpoint: url,
    }

    if (!response.ok) {
      result.error = data.message || data.error || `HTTP ${response.status}`
      log.warn("Endpoint execution failed", {
        url,
        status: response.status,
        error: result.error,
      })
    } else {
      log.info("Endpoint execution succeeded", {
        url,
        status: response.status,
        dataKeys: Object.keys(data).slice(0, 5),
      })
    }

    log.operationEnd("Execute Endpoint", response.ok, {
      status: response.status,
    })

    return result
  } catch (error) {
    log.error("Endpoint execution error", {
      url,
      error: String(error),
    })
    log.operationEnd("Execute Endpoint", false, { error: String(error) })

    return {
      success: false,
      data: null,
      entity: endpoint.endpoint.module || "unknown",
      method,
      statusCode: 0,
      error: error instanceof Error ? error.message : String(error),
      endpoint: url,
    }
  }
}

/**
 * Execute a query plan using endpoint-based execution
 */
export async function executeQueryPlanViaEndpoints(
  plan: {
    steps: Array<{
      entity: string
      action?: string
      method?: string
      operation?: string
      filters?: Record<string, any>
      relations?: string[]
    }>
  },
  authHeaders?: AuthHeaders
): Promise<{
  success: boolean
  results: EndpointExecutionResult[]
  finalResult: any
}> {
  log.operationStart("Execute Plan via Endpoints", {
    steps: plan.steps.length,
  })

  const results: EndpointExecutionResult[] = []
  let lastSuccessfulData: any = null

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i]
    const operation = step.action || step.method || step.operation || "list"

    // Find the best endpoint
    const endpoint = await findBestEndpoint(
      step.entity,
      operation,
      step.filters
    )

    if (!endpoint) {
      log.warn("No endpoint found for step", {
        stepIndex: i,
        entity: step.entity,
        operation,
      })
      results.push({
        success: false,
        data: null,
        entity: step.entity,
        method: operationToMethod(operation),
        statusCode: 0,
        error: `No endpoint found for ${operation} ${step.entity}`,
      })
      continue
    }

    // Build params from filters
    const params = { ...step.filters }

    // Add relations to expand
    if (step.relations && step.relations.length > 0) {
      params.expand = step.relations.join(",")
      params.fields = step.relations.map(r => `${step.entity}.${r}.*`).join(",")
    }

    // Execute the endpoint
    const result = await executeEndpoint(endpoint, params, undefined, authHeaders)
    results.push(result)

    if (result.success) {
      lastSuccessfulData = result.data
    } else {
      // If a step fails, continue but log
      log.warn("Step execution failed", {
        stepIndex: i,
        error: result.error,
      })
    }
  }

  const overallSuccess = results.some(r => r.success)

  log.operationEnd("Execute Plan via Endpoints", overallSuccess, {
    totalSteps: plan.steps.length,
    successfulSteps: results.filter(r => r.success).length,
  })

  return {
    success: overallSuccess,
    results,
    finalResult: lastSuccessfulData,
  }
}

/**
 * Check if endpoint execution mode is enabled
 */
export function isEndpointExecutionEnabled(): boolean {
  return EXECUTION_MODE === "endpoint"
}

/**
 * Get execution mode statistics
 */
export function getExecutionModeStats(): {
  mode: string
  baseUrl: string
  enabled: boolean
} {
  return {
    mode: EXECUTION_MODE,
    baseUrl: API_BASE_URL,
    enabled: isEndpointExecutionEnabled(),
  }
}
