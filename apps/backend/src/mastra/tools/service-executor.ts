/**
 * Service Executor
 *
 * Executes service calls against custom modules and core Medusa APIs.
 * This enables the AI to fetch data with proper relations support.
 *
 * For custom modules: Uses container.resolve() to get the service
 * For core entities: Uses HTTP fetch against the Admin API
 */

import { MedusaContainer } from "@medusajs/framework"
import {
  ENTITY_REGISTRY,
  CustomEntityConfig,
  CoreEntityConfig,
  getEntityConfig,
} from "../schema/entity-registry"
import { getLinksForEntity, isLinkParserInitialized } from "../services/link-parser"
import { serviceExecutorLogger as log } from "../services/logger"

// Types
export interface ServiceCallArgs {
  entity: string
  method: "list" | "retrieve" | "listAndCount" | "create" | "update" | "delete" | string
  filters?: Record<string, any>
  config?: {
    relations?: string[]
    take?: number
    skip?: number
    select?: string[]
    order?: Record<string, "ASC" | "DESC">
  }
  id?: string // For retrieve/update/delete
  data?: Record<string, any> // For create/update
}

export interface ServiceCallResult {
  success: boolean
  data?: any
  count?: number
  error?: string
  entity: string
  method: string
}

export interface AuthHeaders {
  authorization?: string
  cookie?: string
}

/**
 * Execute a service call against the entity registry
 *
 * @param container - Medusa container for resolving services
 * @param args - Service call arguments
 * @param authHeaders - Optional authentication headers for API calls
 */
export async function executeServiceCall(
  container: MedusaContainer,
  args: ServiceCallArgs,
  authHeaders?: AuthHeaders
): Promise<ServiceCallResult> {
  const entityConfig = getEntityConfig(args.entity)

  if (!entityConfig) {
    return {
      success: false,
      error: `Unknown entity: ${args.entity}. Available entities: ${Object.keys(ENTITY_REGISTRY).join(", ")}`,
      entity: args.entity,
      method: args.method,
    }
  }

  try {
    if (entityConfig.is_core) {
      return await executeCoreApiCall(args, entityConfig as CoreEntityConfig, authHeaders)
    } else {
      return await executeCustomServiceCall(container, args, entityConfig as CustomEntityConfig)
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      entity: args.entity,
      method: args.method,
    }
  }
}

/**
 * Build the MedusaService method name for an entity
 *
 * MedusaService generates methods like:
 * - listDesigns (list + PascalCase plural model name)
 * - retrieveDesign (retrieve + PascalCase singular model name)
 * - createDesigns (create + PascalCase plural model name)
 * - updateDesigns (update + PascalCase plural model name)
 * - deleteDesigns (delete + PascalCase plural model name)
 */
// Irregular plurals that Medusa uses (based on English grammar)
const IRREGULAR_PLURALS: Record<string, string> = {
  Person: "People",
  Child: "Children",
  Man: "Men",
  Woman: "Women",
  Foot: "Feet",
  Tooth: "Teeth",
  Goose: "Geese",
  Mouse: "Mice",
  Ox: "Oxen",
  Index: "Indices",
  Matrix: "Matrices",
  Vertex: "Vertices",
  Analysis: "Analyses",
  Basis: "Bases",
  Crisis: "Crises",
  Diagnosis: "Diagnoses",
  // Words ending in -y with consonant before -> -ies
  Category: "Categories",
  // Words ending in -s, -ss, -sh, -ch, -x, -z -> add -es
  // Already handled by default, but some specific ones:
  Tax: "Taxes",
  Box: "Boxes",
}

/**
 * Check if any of the requested relations are linked relations (defined via defineLink)
 * These require query.graph() instead of service methods.
 *
 * @param entityName - The entity being queried
 * @param relations - Requested relations
 * @returns Array of linked relation names, or empty array if none
 */
function getLinkedRelations(entityName: string, relations?: string[]): string[] {
  if (!relations || relations.length === 0) {
    return []
  }

  // If link parser isn't initialized, assume no linked relations
  if (!isLinkParserInitialized()) {
    return []
  }

  const entityLinks = getLinksForEntity(entityName)
  if (entityLinks.length === 0) {
    return []
  }

  // Get the link target names (the field names)
  const linkedFieldNames = new Set<string>()
  for (const link of entityLinks) {
    // The targetLinkable is the field name for the linked entity
    if (link.fieldName) {
      linkedFieldNames.add(link.fieldName)
    }
    // Also add the normalized target linkable name
    linkedFieldNames.add(link.targetLinkable.toLowerCase())
    // And without trailing 's'
    linkedFieldNames.add(link.targetLinkable.toLowerCase().replace(/s$/, ""))
  }

  // Find which requested relations are linked
  return relations.filter((rel) => linkedFieldNames.has(rel.toLowerCase()))
}

function buildMethodName(operation: string, modelName: string): string {
  // Convert entity name to PascalCase
  // If the modelName is already PascalCase (no underscores), preserve its casing
  // Otherwise, convert snake_case to PascalCase
  const pascalCase = modelName.includes("_")
    ? modelName
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join("")
    : modelName.charAt(0).toUpperCase() + modelName.slice(1)

  // retrieve uses singular, others use plural
  if (operation === "retrieve") {
    return `retrieve${pascalCase}`
  }

  // Check for irregular plurals first
  if (IRREGULAR_PLURALS[pascalCase]) {
    return `${operation}${IRREGULAR_PLURALS[pascalCase]}`
  }

  // Handle regular pluralization rules
  let plural: string
  if (pascalCase.endsWith("s") || pascalCase.endsWith("x") || pascalCase.endsWith("z") ||
      pascalCase.endsWith("ch") || pascalCase.endsWith("sh")) {
    // Words ending in s, x, z, ch, sh -> add 'es'
    plural = `${pascalCase}es`
  } else if (pascalCase.endsWith("y")) {
    // Check if consonant before y
    const beforeY = pascalCase.charAt(pascalCase.length - 2)
    if (!"aeiouAEIOU".includes(beforeY)) {
      // Consonant + y -> ies (e.g., Category -> Categories)
      plural = `${pascalCase.slice(0, -1)}ies`
    } else {
      // Vowel + y -> just add s (e.g., Key -> Keys)
      plural = `${pascalCase}s`
    }
  } else {
    // Default: just add 's'
    plural = `${pascalCase}s`
  }

  return `${operation}${plural}`
}

/**
 * Find a service method by trying multiple naming conventions
 *
 * Tries in order:
 * 1. Built method name (using pluralization rules)
 * 2. Direct scan of service methods matching pattern
 *
 * This handles cases where Medusa's generated method name differs from our rules.
 */
function findServiceMethod(
  service: any,
  operation: string,
  modelName: string
): string | null {
  // First try the built method name
  const builtMethod = buildMethodName(operation, modelName)
  if (typeof service[builtMethod] === "function") {
    return builtMethod
  }

  // Get all function names from service
  const allMethods = Object.keys(service).filter((k) => typeof service[k] === "function")

  // Try to find a method matching the pattern: operation + some form of modelName
  const operationLower = operation.toLowerCase()
  const modelLower = modelName.toLowerCase()

  // Pattern matching strategies
  const patterns = [
    // Exact match with different capitalization
    new RegExp(`^${operationLower}${modelLower}s?$`, "i"),
    // Common plural forms
    new RegExp(`^${operationLower}${modelLower.replace(/y$/, "ie")}s$`, "i"),
    // Irregular plurals
    new RegExp(`^${operationLower}(people|children|men|women)$`, "i"),
    // Generic model name pattern
    new RegExp(`^${operationLower}[A-Z]`, "i"),
  ]

  for (const pattern of patterns) {
    const match = allMethods.find((m) => pattern.test(m))
    if (match) {
      log.debug("Found method via pattern matching", { method: match, operation, modelName })
      return match
    }
  }

  // Last resort: look for any method starting with the operation
  // that contains part of the model name
  const partialMatch = allMethods.find((m) => {
    const mLower = m.toLowerCase()
    return (
      mLower.startsWith(operationLower) &&
      (mLower.includes(modelLower.substring(0, 4)) ||
        mLower.includes(modelLower.substring(0, 3)))
    )
  })

  if (partialMatch) {
    log.debug("Found method via partial match", { method: partialMatch, operation, modelName })
    return partialMatch
  }

  return null
}

/**
 * Execute a query using query.graph() for fetching linked relations
 *
 * This is used when the requested relations are linked via defineLink()
 * rather than being direct model relations. query.graph() is the only way
 * to fetch linked data in Medusa.
 */
async function executeWithQueryGraph(
  container: MedusaContainer,
  args: ServiceCallArgs,
  linkedRelations: string[]
): Promise<ServiceCallResult> {
  const { method, filters, id } = args

  try {
    // Use the string literal "query" directly since ContainerRegistrationKeys may not resolve correctly
    // in the Mastra context. The string "query" is the actual registration key value.
    const query = container.resolve("query") as any

    // Determine the entity name for query.graph (uses table name / plural form)
    // The entity name in query.graph is typically the plural snake_case form
    // args.entity is already snake_case (e.g., "production_run"), just add "s" for plural
    const entityName = args.entity + "s"

    // Build fields array: all base fields plus linked relation fields
    const fields: string[] = ["*"]
    for (const rel of linkedRelations) {
      fields.push(`${rel}.*`)
    }

    // Also include any non-linked relations
    const allRelations = args.config?.relations || []
    const nonLinkedRelations = allRelations.filter((r) => !linkedRelations.includes(r))
    for (const rel of nonLinkedRelations) {
      if (!fields.includes(`${rel}.*`)) {
        fields.push(`${rel}.*`)
      }
    }

    // Build the graph query
    const graphQuery: {
      entity: string
      fields: string[]
      filters?: Record<string, any>
      pagination?: { skip?: number; take?: number }
    } = {
      entity: entityName,
      fields,
    }

    // Add filters
    if (method === "retrieve" && id) {
      graphQuery.filters = { id }
    } else if (filters && Object.keys(filters).length > 0) {
      graphQuery.filters = filters
    }

    // Add pagination for list operations
    if (method === "list" || method === "listAndCount") {
      graphQuery.pagination = {
        skip: args.config?.skip || 0,
        take: args.config?.take || 20,
      }
    }

    log.debug("query.graph() call", graphQuery)

    const { data, metadata } = await query.graph(graphQuery)

    // Handle different response types based on method
    if (method === "retrieve") {
      const item = Array.isArray(data) ? data[0] : data
      return {
        success: true,
        data: item,
        entity: args.entity,
        method,
      }
    }

    if (method === "listAndCount") {
      return {
        success: true,
        data: data || [],
        count: (metadata as any)?.count || (data as any[])?.length || 0,
        entity: args.entity,
        method,
      }
    }

    // Default: list
    return {
      success: true,
      data: data || [],
      entity: args.entity,
      method,
    }
  } catch (error: any) {
    log.error("query.graph() error", { entity: args.entity, error: error?.message || String(error) })
    return {
      success: false,
      error: error?.message || "Failed to execute query.graph()",
      entity: args.entity,
      method,
    }
  }
}

/**
 * Execute a call against a custom module service
 *
 * If linked relations are requested (defined via defineLink), uses query.graph()
 * instead of service methods to properly fetch the linked data.
 */
async function executeCustomServiceCall(
  container: MedusaContainer,
  args: ServiceCallArgs,
  config: CustomEntityConfig
): Promise<ServiceCallResult> {
  const { method, id, data } = args
  // Sanitize filters to remove pagination keys that shouldn't be filters
  const filters = sanitizeFilters(args.filters)

  // Check if any requested relations are linked relations (require query.graph)
  const linkedRelations = getLinkedRelations(args.entity, args.config?.relations)

  // If we have linked relations and it's a read operation, use query.graph()
  if (linkedRelations.length > 0 && (method === "list" || method === "retrieve" || method === "listAndCount")) {
    log.info("Using query.graph() for linked relations", {
      entity: args.entity,
      linkedRelations,
    })
    return executeWithQueryGraph(container, args, linkedRelations)
  }

  // Resolve the service from the container
  const service = container.resolve(config.module) as any

  if (!service) {
    throw new Error(`Service not found for module: ${config.module}`)
  }

  const queryConfig = buildQueryConfig(args, config)

  // Get the model name from the entity (e.g., "design" -> "Design")
  const modelName = config.model_name || args.entity

  let result: any

  switch (method) {
    case "retrieve": {
      if (!id) {
        throw new Error("ID required for retrieve operation")
      }
      const retrieveMethod = findServiceMethod(service, "retrieve", modelName)
      if (!retrieveMethod) {
        const availableMethods = Object.keys(service).filter(k => typeof service[k] === 'function').join(', ')
        throw new Error(`Method retrieve${modelName} not found on service. Available methods: ${availableMethods}`)
      }
      result = await service[retrieveMethod](id, queryConfig)
      return { success: true, data: result, entity: args.entity, method }
    }

    case "list": {
      const listMethod = findServiceMethod(service, "list", modelName)
      if (!listMethod) {
        const availableMethods = Object.keys(service).filter(k => typeof service[k] === 'function').join(', ')
        throw new Error(`Method list${modelName}* not found on service. Available methods: ${availableMethods}`)
      }
      result = await service[listMethod](filters || {}, queryConfig)
      return { success: true, data: result, entity: args.entity, method }
    }

    case "listAndCount": {
      const listAndCountMethod = findServiceMethod(service, "listAndCount", modelName)
      if (!listAndCountMethod) {
        const availableMethods = Object.keys(service).filter(k => typeof service[k] === 'function').join(', ')
        throw new Error(`Method listAndCount${modelName}* not found on service. Available methods: ${availableMethods}`)
      }
      const [items, count] = await service[listAndCountMethod](filters || {}, queryConfig)
      return { success: true, data: items, count, entity: args.entity, method }
    }

    case "create": {
      if (!data) {
        throw new Error("Data required for create operation")
      }
      const createMethod = findServiceMethod(service, "create", modelName)
      if (!createMethod) {
        const availableMethods = Object.keys(service).filter(k => typeof service[k] === 'function').join(', ')
        throw new Error(`Method create${modelName}* not found on service. Available methods: ${availableMethods}`)
      }
      result = await service[createMethod](data)
      return { success: true, data: result, entity: args.entity, method }
    }

    case "update": {
      if (!id) {
        throw new Error("ID required for update operation")
      }
      if (!data) {
        throw new Error("Data required for update operation")
      }
      const updateMethod = findServiceMethod(service, "update", modelName)
      if (!updateMethod) {
        const availableMethods = Object.keys(service).filter(k => typeof service[k] === 'function').join(', ')
        throw new Error(`Method update${modelName}* not found on service. Available methods: ${availableMethods}`)
      }
      result = await service[updateMethod]({ id, ...data })
      return { success: true, data: result, entity: args.entity, method }
    }

    case "delete": {
      if (!id) {
        throw new Error("ID required for delete operation")
      }
      const deleteMethod = findServiceMethod(service, "delete", modelName)
      if (!deleteMethod) {
        const availableMethods = Object.keys(service).filter(k => typeof service[k] === 'function').join(', ')
        throw new Error(`Method delete${modelName}* not found on service. Available methods: ${availableMethods}`)
      }
      await service[deleteMethod](id)
      return { success: true, data: { deleted: true, id }, entity: args.entity, method }
    }

    default:
      // Try calling the method directly (for custom methods like createInvWithLines)
      if (typeof service[method] === "function") {
        result = await service[method](filters || data, queryConfig)
        return { success: true, data: result, entity: args.entity, method }
      }
      throw new Error(`Unknown method: ${method}. Available: ${config.service_methods.join(", ")}`)
  }
}

/**
 * Execute a call against the core Medusa Admin API
 */
async function executeCoreApiCall(
  args: ServiceCallArgs,
  config: CoreEntityConfig,
  authHeaders?: AuthHeaders
): Promise<ServiceCallResult> {
  const backendUrl = process.env.MEDUSA_BACKEND_URL || process.env.URL || "http://localhost:9000"

  const { method, filters, id, data } = args
  let apiPath = config.api_path
  let httpMethod = "GET"

  // Build the URL based on the operation
  switch (method) {
    case "retrieve":
      if (!id) {
        throw new Error("ID required for retrieve operation")
      }
      apiPath = `${config.api_path}/${id}`
      httpMethod = "GET"
      break

    case "list":
    case "listAndCount":
      apiPath = config.api_path
      httpMethod = "GET"
      break

    case "create":
      apiPath = config.api_path
      httpMethod = "POST"
      break

    case "update":
      if (!id) {
        throw new Error("ID required for update operation")
      }
      apiPath = `${config.api_path}/${id}`
      httpMethod = "POST"
      break

    case "delete":
      if (!id) {
        throw new Error("ID required for delete operation")
      }
      apiPath = `${config.api_path}/${id}`
      httpMethod = "DELETE"
      break

    default:
      throw new Error(`Unsupported method for core API: ${method}`)
  }

  const url = new URL(`${backendUrl}${apiPath}`)

  // Add query parameters for GET requests
  if (httpMethod === "GET") {
    // Add filters
    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value))
        }
      }
    }

    // Add pagination
    if (args.config?.take) {
      url.searchParams.append("limit", String(args.config.take))
    }
    if (args.config?.skip) {
      url.searchParams.append("offset", String(args.config.skip))
    }

    // Add relations using Medusa's fields parameter format
    // Relations are prefixed with * (e.g., "*customer,*items")
    if (args.config?.relations && args.config.relations.length > 0) {
      const fieldsValue = args.config.relations.map((r) => `*${r}`).join(",")
      url.searchParams.append("fields", fieldsValue)
    }
  }

  // Build headers
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (authHeaders?.authorization) {
    headers["Authorization"] = authHeaders.authorization
  }
  if (authHeaders?.cookie) {
    headers["Cookie"] = authHeaders.cookie
  }

  // Build request options
  const requestInit: RequestInit = { method: httpMethod, headers }
  if (data && (httpMethod === "POST" || httpMethod === "PUT" || httpMethod === "PATCH")) {
    requestInit.body = JSON.stringify(data)
  }

  // Make the request
  const response = await fetch(url.toString(), requestInit)
  const responseText = await response.text()

  let responseData: any
  try {
    responseData = JSON.parse(responseText)
  } catch {
    responseData = responseText
  }

  if (!response.ok) {
    return {
      success: false,
      error: responseData?.message || `API error: ${response.status}`,
      entity: args.entity,
      method,
    }
  }

  // Extract count if available
  const count = responseData?.count ?? responseData?.total

  return {
    success: true,
    data: responseData,
    ...(count !== undefined ? { count } : {}),
    entity: args.entity,
    method,
  }
}

/**
 * Sanitize filters by removing pagination keys that shouldn't be filters
 * LLMs sometimes put limit/offset in filters incorrectly
 */
function sanitizeFilters(filters: Record<string, any> | undefined): Record<string, any> | undefined {
  if (!filters) return undefined

  // Keys that are pagination/config options, not actual filters
  const nonFilterKeys = ['limit', 'take', 'offset', 'skip', 'relations', 'select', 'order']

  const sanitized: Record<string, any> = {}
  const removedKeys: string[] = []
  for (const [key, value] of Object.entries(filters)) {
    if (!nonFilterKeys.includes(key.toLowerCase())) {
      sanitized[key] = value
    } else {
      removedKeys.push(key)
    }
  }

  if (removedKeys.length > 0) {
    log.debug("Removed non-filter keys from filters", { removedKeys })
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined
}

/**
 * Build query configuration for service calls
 */
function buildQueryConfig(args: ServiceCallArgs, config: CustomEntityConfig): Record<string, any> {
  const queryConfig: Record<string, any> = {}

  // Handle relations
  if (args.config?.relations && args.config.relations.length > 0) {
    // Filter to only valid relations for this entity
    const validRelations = args.config.relations.filter((r) =>
      config.relations.includes(r)
    )
    if (validRelations.length > 0) {
      queryConfig.relations = validRelations
    }
  }

  // Handle pagination - also extract from filters if LLM put them there
  const filterLimit = args.filters?.limit || args.filters?.take
  const filterOffset = args.filters?.offset || args.filters?.skip

  if (args.config?.take !== undefined) {
    queryConfig.take = args.config.take
  } else if (filterLimit !== undefined) {
    queryConfig.take = filterLimit
  }

  if (args.config?.skip !== undefined) {
    queryConfig.skip = args.config.skip
  } else if (filterOffset !== undefined) {
    queryConfig.skip = filterOffset
  }

  // Handle select
  if (args.config?.select && args.config.select.length > 0) {
    queryConfig.select = args.config.select
  }

  // Handle ordering
  if (args.config?.order) {
    queryConfig.order = args.config.order
  }

  return queryConfig
}

/**
 * Parse a natural language message to extract service call parameters
 *
 * @param message - Natural language message
 * @param entities - Detected entities from the message
 * @returns Array of service call arguments to execute
 */
export function parseDataOperations(
  message: string,
  entities: string[]
): ServiceCallArgs[] {
  const operations: ServiceCallArgs[] = []
  const messageLower = message.toLowerCase()

  for (const entity of entities) {
    const config = getEntityConfig(entity)
    if (!config) continue

    // Determine the operation type
    let method: ServiceCallArgs["method"] = "list"
    let id: string | undefined
    const filters: Record<string, any> = {}

    // Check for specific ID patterns (e.g., "order ord_123", "design design_abc")
    const idPattern = new RegExp(`(?:${entity}|id)[:\\s]+([a-z0-9_-]+)`, "i")
    const idMatch = message.match(idPattern)
    if (idMatch) {
      id = idMatch[1]
      method = "retrieve"
    }

    // Check for list-like queries
    if (
      messageLower.includes("list") ||
      messageLower.includes("show all") ||
      messageLower.includes("get all") ||
      messageLower.includes("fetch all")
    ) {
      method = "list"
    }

    // Check for count queries
    if (messageLower.includes("how many") || messageLower.includes("count")) {
      method = "listAndCount"
    }

    // Check for status filters
    const statusMatch = message.match(/status[:\s]+(\w+)/i)
    if (statusMatch) {
      filters.status = statusMatch[1]
    }

    // Check for customer name filters (for orders)
    // Note: relations is declared below, we'll add customer relation later
    let shouldAddCustomerRelation = false
    if (entity === "order") {
      // Look for "customer [Name]" or "for [Name]" patterns
      const customerNamePatterns = [
        /customer[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
        /for\s+(?:this\s+)?customer\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
        /orders?\s+(?:for|of|by)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
      ]

      for (const pattern of customerNamePatterns) {
        const nameMatch = message.match(pattern)
        if (nameMatch && nameMatch[1]) {
          // Add customer name as a search/filter parameter
          // Note: Medusa API uses 'q' for search queries
          filters.q = nameMatch[1].trim()
          shouldAddCustomerRelation = true
          break
        }
      }
    }

    // Check for email filter
    const emailMatch = message.match(/email[:\s]+([^\s]+@[^\s]+)/i)
    if (emailMatch) {
      filters.email = emailMatch[1]
    }

    // Check for name filter (generic)
    if (!filters.q) {
      const namePatterns = [
        /name[:\s]+["']?([^"'\n]+)["']?/i,
        /named?\s+["']?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)["']?/i,
      ]
      for (const pattern of namePatterns) {
        const nameMatch = message.match(pattern)
        if (nameMatch && nameMatch[1]) {
          filters.q = nameMatch[1].trim()
          break
        }
      }
    }

    // Check for limit
    const limitMatch = message.match(/(?:first|top|limit)[:\s]+(\d+)/i)
    const take = limitMatch ? parseInt(limitMatch[1], 10) : 10

    // Determine which relations to include
    const relations: string[] = []
    const availableRelations = config.is_core
      ? (config as CoreEntityConfig).relations || []
      : (config as CustomEntityConfig).relations

    // Check for specifically mentioned relations first
    for (const rel of availableRelations) {
      // Check for both singular and plural forms, and with/without underscores
      const relVariants = [
        rel.toLowerCase(),
        rel.replace(/_/g, " ").toLowerCase(),
        rel.replace(/s$/, "").toLowerCase(), // Singular form
        rel.replace(/_/g, " ").replace(/s$/, "").toLowerCase(),
      ]

      for (const variant of relVariants) {
        if (messageLower.includes(variant)) {
          if (!relations.includes(rel)) {
            relations.push(rel)
          }
          break
        }
      }
    }

    // If no specific relations found but user wants relations, include defaults
    if (
      relations.length === 0 &&
      (messageLower.includes("with") ||
        messageLower.includes("include") ||
        messageLower.includes("details") ||
        messageLower.includes("all"))
    ) {
      // Include commonly useful relations
      relations.push(...availableRelations.slice(0, 3))
    }

    // Add customer relation if filtering by customer name
    if (shouldAddCustomerRelation && !relations.includes("customer")) {
      relations.push("customer")
    }

    operations.push({
      entity,
      method,
      ...(id ? { id } : {}),
      ...(Object.keys(filters).length > 0 ? { filters } : {}),
      config: {
        take,
        ...(relations.length > 0 ? { relations } : {}),
      },
    })
  }

  return operations
}

/**
 * Execute multiple service calls and combine results
 */
export async function executeMultipleServiceCalls(
  container: MedusaContainer,
  operations: ServiceCallArgs[],
  authHeaders?: AuthHeaders
): Promise<Record<string, ServiceCallResult>> {
  const results: Record<string, ServiceCallResult> = {}

  for (const op of operations) {
    const key = op.id ? `${op.entity}:${op.id}` : op.entity
    results[key] = await executeServiceCall(container, op, authHeaders)
  }

  return results
}

/**
 * NOTE: Reference resolution is now handled by the LLM-driven query planner.
 * See src/mastra/tools/query-planner.ts and src/mastra/tools/plan-executor.ts
 *
 * The query planner uses the entity registry's resolvable_refs metadata to
 * generate multi-step query plans that handle complex relationships like:
 * - "orders for customer Saransh Sharma" → customer(q) → orders(customer_id)
 * - "inventory orders for partner ABC" → partner(q) → inventory_orders(partner_id)
 * - "production runs for design X" → design(q) → production_runs(design_id)
 */

/**
 * Format service call results for LLM consumption
 */
export function formatResultsForLLM(results: Record<string, ServiceCallResult>): string {
  const lines: string[] = []

  for (const [key, result] of Object.entries(results)) {
    lines.push(`## ${key} (${result.method})`)

    if (!result.success) {
      lines.push(`Error: ${result.error}`)
      continue
    }

    if (result.count !== undefined) {
      lines.push(`Total count: ${result.count}`)
    }

    // Format the data
    if (Array.isArray(result.data)) {
      lines.push(`Found ${result.data.length} items:`)
      for (const item of result.data.slice(0, 10)) {
        const preview = buildItemPreview(item)
        lines.push(`- ${preview}`)
      }
      if (result.data.length > 10) {
        lines.push(`... and ${result.data.length - 10} more`)
      }
    } else if (result.data) {
      const preview = JSON.stringify(result.data, null, 2).slice(0, 1000)
      lines.push("```json")
      lines.push(preview)
      lines.push("```")
    }

    lines.push("")
  }

  return lines.join("\n")
}

/**
 * Build a preview string for an item
 */
function buildItemPreview(item: any): string {
  if (!item) return "(empty)"

  const parts: string[] = []

  // Primary identifiers
  if (item.id) parts.push(`id: ${item.id}`)

  // Name fields (multiple formats)
  if (item.name) parts.push(`name: ${item.name}`)
  if (item.first_name || item.last_name) {
    parts.push(`name: ${item.first_name || ""} ${item.last_name || ""}`.trim())
  }

  // Common descriptive fields
  if (item.title) parts.push(`title: ${item.title}`)
  if (item.label) parts.push(`label: ${item.label}`)
  if (item.description) parts.push(`description: ${item.description}`)
  if (item.value) parts.push(`value: ${item.value}`)
  if (item.code) parts.push(`code: ${item.code}`)

  // Product/inventory fields
  if (item.handle) parts.push(`handle: ${item.handle}`)
  if (item.sku) parts.push(`sku: ${item.sku}`)

  // Status/state fields
  if (item.status) parts.push(`status: ${item.status}`)
  if (item.is_active !== undefined) parts.push(`active: ${item.is_active}`)

  // Contact fields
  if (item.email) parts.push(`email: ${item.email}`)

  // Order/transaction fields
  if (item.display_id) parts.push(`display_id: ${item.display_id}`)
  if (item.total) parts.push(`total: ${item.total}`)
  if (item.currency_code) parts.push(`currency: ${item.currency_code}`)

  // If we have parts, join them; otherwise show a truncated JSON preview
  return parts.length > 0 ? parts.join(", ") : JSON.stringify(item).slice(0, 150)
}
