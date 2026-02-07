/**
 * Dynamic Schema Service
 *
 * Phase 11: True Dynamic Medusa MCP Integration
 *
 * This service fetches entity schemas dynamically:
 * - Core Medusa entities: Query Medusa MCP server for docs
 * - Custom modules: Search codebase via Code-Index for real API/workflow info
 *
 * Key features:
 * - Dynamic MCP queries for core Medusa entities
 * - Code-Index search for custom module details (routes, services, workflows)
 * - Entity discovery for unknown entities
 * - 30-minute caching to avoid repeated lookups
 * - Parallel fetching for multiple entities
 * - Graceful fallback to static registry if dynamic lookup fails
 */

import { getEntityConfig, isCustomEntity, getEntityRelations, CustomEntityConfig } from "../schema/entity-registry"
import {
  getEntitySchemaFromMCP,
  discoverEntityViaMCP,
  MCPEntitySchema,
} from "./medusa-mcp-client"
import { searchCode, CodeSearchResult } from "./code-index"
import {
  loadModuleSpec,
  buildLLMContextFromSpec,
  getValidRelations as getSpecRelations,
  getFilterableFields,
  ModuleSpec,
} from "./spec-loader"
import {
  searchSpecs,
  findRelevantModules,
  getSpecContextForLLM,
  SpecSearchResult,
} from "./spec-store"

// ============================================
// TYPES
// ============================================

export interface CustomEntityCodeContext {
  apiRoutes: string[]      // e.g., ["GET /admin/designs", "POST /admin/designs"]
  serviceMethods: string[] // e.g., ["listDesigns", "createDesign"]
  workflowSteps: string[]  // e.g., ["validateDesignStep", "createDesignStep"]
  modelFields: string[]    // e.g., ["id", "name", "status", "created_at"]
}

export interface DynamicEntitySchema {
  entityName: string
  relations: string[]      // Valid expandable relations
  filters: string[]        // Available filter parameters
  apiPath?: string         // API path from MCP
  fetchedAt: number
  source: "mcp" | "static" | "code-index" // Track where schema came from
  codeContext?: CustomEntityCodeContext  // Code-derived context for custom entities
}

export interface EntityDiscoveryResult {
  isValid: boolean
  entityType: "core" | "custom" | "unknown"
  schema: DynamicEntitySchema | null
}

// ============================================
// CACHE
// ============================================

const schemaCache = new Map<string, DynamicEntitySchema>()
const SCHEMA_CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutes

/**
 * Check if a cached schema is still valid
 */
function isCacheValid(schema: DynamicEntitySchema): boolean {
  return Date.now() - schema.fetchedAt < SCHEMA_CACHE_TTL_MS
}

/**
 * Get cached schema if valid
 */
function getCachedSchema(entityName: string): DynamicEntitySchema | null {
  const cached = schemaCache.get(entityName.toLowerCase())
  if (cached && isCacheValid(cached)) {
    return cached
  }
  return null
}

/**
 * Cache a schema
 */
function cacheSchema(schema: DynamicEntitySchema): void {
  schemaCache.set(schema.entityName.toLowerCase(), schema)
}

// ============================================
// SCHEMA FETCHING
// ============================================

/**
 * Fetch schema for a single entity
 *
 * Priority:
 * 1. Return from cache if valid
 * 2. For custom entities, use static registry (we control those)
 * 3. For core entities, query Medusa MCP dynamically
 * 4. Fallback to static registry if MCP fails
 */
export async function fetchEntitySchema(entityName: string): Promise<DynamicEntitySchema> {
  const normalizedName = entityName.toLowerCase()

  // Check cache first
  const cached = getCachedSchema(normalizedName)
  if (cached) {
    console.log(`[DynamicSchema] Cache hit for ${normalizedName}`)
    return cached
  }

  // For custom entities, always use static registry
  if (isCustomEntity(normalizedName)) {
    console.log(`[DynamicSchema] Using static registry for custom entity: ${normalizedName}`)
    return createStaticSchema(normalizedName)
  }

  // For core entities, query Medusa MCP dynamically
  console.log(`[DynamicSchema] Querying Medusa MCP for: ${normalizedName}`)
  try {
    const mcpResult = await getEntitySchemaFromMCP(normalizedName)

    if (mcpResult) {
      const schema = convertMCPSchemaToInternal(mcpResult)
      cacheSchema(schema)
      console.log(`[DynamicSchema] Got MCP schema for ${normalizedName}:`, {
        relations: schema.relations.slice(0, 5),
        filters: schema.filters.slice(0, 5),
        apiPath: schema.apiPath,
      })
      return schema
    }
  } catch (error) {
    console.warn(`[DynamicSchema] MCP fetch failed for ${normalizedName}:`, error)
  }

  // Fallback to static registry
  console.log(`[DynamicSchema] Falling back to static registry for: ${normalizedName}`)
  return createStaticSchema(normalizedName)
}

/**
 * Convert MCP schema to internal format
 */
function convertMCPSchemaToInternal(mcpSchema: MCPEntitySchema): DynamicEntitySchema {
  return {
    entityName: mcpSchema.entityName,
    relations: mcpSchema.relations,
    filters: mcpSchema.filters,
    apiPath: mcpSchema.apiPath || undefined,
    fetchedAt: Date.now(),
    source: "mcp",
  }
}

/**
 * Create a schema from spec files or static registry
 * Priority: Spec file > Code-Index > Static registry
 */
async function createStaticSchema(entityName: string): Promise<DynamicEntitySchema> {
  const config = getEntityConfig(entityName)

  // For custom entities, try to load from spec file first
  if (isCustomEntity(entityName)) {
    try {
      const spec = await loadModuleSpec(entityName)
      if (spec) {
        console.log(`[DynamicSchema] Loaded spec for ${entityName}`)
        return createSchemaFromSpec(entityName, spec)
      }
    } catch (error) {
      console.warn(`[DynamicSchema] Failed to load spec for ${entityName}:`, error)
    }
  }

  // Fallback to static registry + code-index
  const relations = getEntityRelations(entityName)

  const schema: DynamicEntitySchema = {
    entityName,
    relations,
    filters: [], // Static registry doesn't have filter info
    apiPath: config?.is_core ? (config as any).api_path : undefined,
    fetchedAt: Date.now(),
    source: "static",
  }

  // For custom entities, enrich with code context
  if (config && isCustomEntity(entityName)) {
    try {
      const codeContext = await getCustomEntityCodeContext(entityName, config as CustomEntityConfig)
      schema.codeContext = codeContext
      schema.source = "code-index" // Mark as enriched via code-index
      console.log(`[DynamicSchema] Enriched ${entityName} with code context`)
    } catch (error) {
      console.warn(`[DynamicSchema] Failed to get code context for ${entityName}:`, error)
    }
  }

  cacheSchema(schema)
  return schema
}

/**
 * Create a DynamicEntitySchema from a loaded ModuleSpec
 */
function createSchemaFromSpec(entityName: string, spec: ModuleSpec): DynamicEntitySchema {
  // Extract relations from spec
  const relations = spec.dataModel.relations.map((r) => r.name)

  // Extract filterable fields
  const filters = spec.dataModel.fields
    .filter((f) => f.filterable)
    .map((f) => f.name)

  // Build code context from spec
  const codeContext: CustomEntityCodeContext = {
    apiRoutes: spec.apiSurface.routes.map((r) => `${r.method} ${r.path}`),
    serviceMethods: spec.services.autoGeneratedMethods,
    workflowSteps: spec.workflows.definitions.flatMap((w) =>
      w.steps.map((s) => s.id)
    ),
    modelFields: spec.dataModel.fields.map((f) => f.name),
  }

  const schema: DynamicEntitySchema = {
    entityName,
    relations,
    filters,
    fetchedAt: Date.now(),
    source: "code-index", // Mark as from spec (which is code-derived)
    codeContext,
  }

  cacheSchema(schema)
  return schema
}

/**
 * Enrich a custom entity schema using Code-Index search
 *
 * Searches the codebase for:
 * - API routes (src/api/**) for the entity
 * - Service methods in the module
 * - Workflow definitions
 * - Model definitions with fields
 *
 * @param entityName - The custom entity name
 * @param config - The entity config from registry
 * @returns Enhanced schema with code-derived information
 */
async function enrichCustomEntityWithCodeIndex(
  entityName: string,
  config: CustomEntityConfig
): Promise<CustomEntityCodeContext> {
  const context: CustomEntityCodeContext = {
    apiRoutes: [],
    serviceMethods: [],
    workflowSteps: [],
    modelFields: [],
  }

  try {
    // Search for API routes
    const apiResults = await searchCode(`/api/admin/${entityName}`)
    context.apiRoutes = extractAPIRoutes(apiResults, entityName)

    // Search for service methods in the module
    const moduleResults = await searchCode(`${config.module}`)
    context.serviceMethods = extractServiceMethods(moduleResults, config.model_name)

    // Search for workflow definitions
    const workflowResults = await searchCode(`${entityName}Workflow`)
    context.workflowSteps = extractWorkflowSteps(workflowResults)

    // Search for model/entity fields
    const modelResults = await searchCode(`class ${config.model_name}`)
    context.modelFields = extractModelFields(modelResults, config.model_name)

    console.log(`[DynamicSchema] Code-Index enrichment for ${entityName}:`, {
      apiRoutes: context.apiRoutes.length,
      serviceMethods: context.serviceMethods.length,
      workflowSteps: context.workflowSteps.length,
      modelFields: context.modelFields.length,
    })
  } catch (error) {
    console.warn(`[DynamicSchema] Code-Index enrichment failed for ${entityName}:`, error)
  }

  return context
}

/**
 * Extract API routes from search results
 */
function extractAPIRoutes(results: CodeSearchResult[], _entityName: string): string[] {
  const routes: string[] = []
  const routePattern = /(GET|POST|PUT|DELETE|PATCH)/i

  for (const result of results) {
    if (result.file.includes("/api/") && routePattern.test(result.content)) {
      // Extract the HTTP method and path
      const method = result.content.match(routePattern)?.[1]?.toUpperCase()
      if (method) {
        // Derive path from file path
        const pathMatch = result.file.match(/src\/api\/(.+)\/route\.ts/)
        if (pathMatch) {
          const apiPath = `/${pathMatch[1].replace(/\[([^\]]+)\]/g, ":$1")}`
          routes.push(`${method} ${apiPath}`)
        }
      }
    }
  }

  return [...new Set(routes)].slice(0, 10) // Dedupe and limit
}

/**
 * Extract service methods from search results
 */
function extractServiceMethods(results: CodeSearchResult[], modelName: string): string[] {
  const methods: string[] = []
  const methodPatterns = [
    /async\s+(\w+)\s*\(/,
    /(\w+)\s*=\s*async/,
    /export\s+(?:async\s+)?function\s+(\w+)/,
  ]

  for (const result of results) {
    for (const pattern of methodPatterns) {
      const match = result.content.match(pattern)
      if (match && match[1]) {
        const methodName = match[1]
        // Filter to likely service methods
        if (
          methodName.startsWith("list") ||
          methodName.startsWith("retrieve") ||
          methodName.startsWith("create") ||
          methodName.startsWith("update") ||
          methodName.startsWith("delete") ||
          methodName.includes(modelName)
        ) {
          methods.push(methodName)
        }
      }
    }
  }

  return [...new Set(methods)].slice(0, 15)
}

/**
 * Extract workflow steps from search results
 */
function extractWorkflowSteps(results: CodeSearchResult[]): string[] {
  const steps: string[] = []
  const stepPatterns = [
    /createStep\s*\(\s*\{\s*id:\s*["']([^"']+)["']/,
    /\.then\s*\(\s*(\w+Step)/,
    /step:\s*["']([^"']+)["']/,
  ]

  for (const result of results) {
    for (const pattern of stepPatterns) {
      const match = result.content.match(pattern)
      if (match && match[1]) {
        steps.push(match[1])
      }
    }
  }

  return [...new Set(steps)].slice(0, 10)
}

/**
 * Extract model fields from search results
 */
function extractModelFields(results: CodeSearchResult[], _modelName: string): string[] {
  const fields: string[] = []
  const fieldPatterns = [
    /@Property\s*\([^)]*\)\s*(\w+):/,
    /(\w+)\s*:\s*(?:string|number|boolean|Date)/,
    /(\w+)\s*=\s*model\.(?:text|id|boolean|dateTime|json)/,
  ]

  for (const result of results) {
    for (const pattern of fieldPatterns) {
      const match = result.content.match(pattern)
      if (match && match[1] && !match[1].startsWith("_")) {
        fields.push(match[1])
      }
    }
  }

  return [...new Set(fields)].slice(0, 20)
}

// ============================================
// CODE CONTEXT CACHE
// ============================================

// Cache for code context
const codeContextCache = new Map<string, { context: CustomEntityCodeContext; timestamp: number }>()
const CODE_CONTEXT_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes (code changes less frequently during session)

/**
 * Get code context for a custom entity with caching
 */
async function getCustomEntityCodeContext(
  entityName: string,
  config: CustomEntityConfig
): Promise<CustomEntityCodeContext> {
  const cacheKey = entityName.toLowerCase()
  const cached = codeContextCache.get(cacheKey)

  if (cached && Date.now() - cached.timestamp < CODE_CONTEXT_CACHE_TTL_MS) {
    console.log(`[DynamicSchema] Code context cache hit for: ${entityName}`)
    return cached.context
  }

  const context = await enrichCustomEntityWithCodeIndex(entityName, config)
  codeContextCache.set(cacheKey, { context, timestamp: Date.now() })

  return context
}

/**
 * Fetch schemas for multiple entities in parallel
 *
 * @param entities - Array of entity names to fetch
 * @param maxEntities - Maximum number of entities to fetch (default 5)
 * @returns Map of entity name to schema
 */
export async function fetchSchemasForEntities(
  entities: string[],
  maxEntities: number = 5
): Promise<Map<string, DynamicEntitySchema>> {
  // Limit to avoid blocking on large queries
  const entitiesToFetch = entities.slice(0, maxEntities)

  console.log(`[DynamicSchema] Fetching schemas for ${entitiesToFetch.length} entities:`, entitiesToFetch)

  // Fetch all in parallel
  const results = await Promise.all(
    entitiesToFetch.map(async (entity) => {
      try {
        const schema = await fetchEntitySchema(entity)
        return { entity, schema }
      } catch (error) {
        console.warn(`[DynamicSchema] Failed to fetch schema for ${entity}:`, error)
        return { entity, schema: await createStaticSchema(entity) }
      }
    })
  )

  // Build result map
  const schemas = new Map<string, DynamicEntitySchema>()
  for (const { entity, schema } of results) {
    schemas.set(entity, schema)
  }

  console.log(`[DynamicSchema] Fetched ${schemas.size} schemas`)
  return schemas
}

// ============================================
// ENTITY DISCOVERY
// ============================================

/**
 * Discover an unknown entity
 *
 * For entities not in the registry, try to discover them via Medusa MCP.
 * This enables handling queries about entities we haven't explicitly registered.
 *
 * @param possibleEntityName - The entity name to discover
 * @returns Discovery result with entity type and schema
 */
export async function discoverEntity(possibleEntityName: string): Promise<EntityDiscoveryResult> {
  const normalizedName = possibleEntityName.toLowerCase()

  // First check if it's a known custom module
  if (isCustomEntity(normalizedName)) {
    const schema = await fetchEntitySchema(normalizedName)
    return {
      isValid: true,
      entityType: "custom",
      schema,
    }
  }

  // Check if it's already in cache
  const cached = getCachedSchema(normalizedName)
  if (cached) {
    return {
      isValid: true,
      entityType: cached.source === "mcp" ? "core" : "custom",
      schema: cached,
    }
  }

  // Try to discover from Medusa MCP
  console.log(`[DynamicSchema] Attempting to discover entity: ${normalizedName}`)
  const discovery = await discoverEntityViaMCP(normalizedName)

  if (discovery.isValid && discovery.schema) {
    const schema = convertMCPSchemaToInternal(discovery.schema)
    cacheSchema(schema)

    console.log(`[DynamicSchema] Discovered entity ${normalizedName}:`, {
      apiPath: schema.apiPath,
      relations: schema.relations.slice(0, 5),
    })

    return {
      isValid: true,
      entityType: "core",
      schema,
    }
  }

  // Check if it's in the static registry (but not custom)
  const config = getEntityConfig(normalizedName)
  if (config) {
    const schema = await createStaticSchema(normalizedName)
    return {
      isValid: true,
      entityType: config.is_core ? "core" : "custom",
      schema,
    }
  }

  // Not found anywhere
  console.log(`[DynamicSchema] Entity ${normalizedName} not found`)
  return {
    isValid: false,
    entityType: "unknown",
    schema: null,
  }
}

/**
 * Check if an entity is known (in registry or discovered via MCP)
 */
export async function isKnownEntity(entityName: string): Promise<boolean> {
  const result = await discoverEntity(entityName)
  return result.isValid
}

// ============================================
// LLM PROMPT BUILDING
// ============================================

/**
 * Build schema documentation for LLM prompt
 *
 * Creates a structured description of entities and their relations
 * that the LLM can use when generating query plans.
 *
 * For core entities: Uses Medusa MCP data
 * For custom entities: Includes code-derived API routes, service methods, etc.
 * Now also includes spec-based data with enum values when available.
 */
export async function buildDynamicSchemaForLLM(
  schemas: Map<string, DynamicEntitySchema>
): Promise<string> {
  if (schemas.size === 0) {
    return ""
  }

  const lines: string[] = [
    "## Dynamic Entity Schemas",
    "",
    "The following schemas were fetched dynamically.",
    "- Core Medusa entities: from Medusa MCP documentation",
    "- Custom modules: from codebase analysis and spec files",
    "",
    "ONLY use the relations, filters, and API routes listed here - do not guess or invent names.",
    "",
  ]

  for (const [entityName, schema] of schemas) {
    const config = getEntityConfig(entityName)
    const isCore = config?.is_core ?? (schema.source === "mcp")
    const isCustom = !isCore

    // Try to load spec for richer context
    let spec: ModuleSpec | null = null
    if (isCustom) {
      try {
        spec = await loadModuleSpec(entityName)
      } catch {
        // Ignore - will use schema data
      }
    }

    lines.push(`### ${entityName}`)
    lines.push(`- Type: ${isCore ? "Core Medusa" : "Custom Module"}`)

    // Source description
    if (spec) {
      lines.push(`- Source: Spec file (comprehensive)`)
    } else if (schema.source === "mcp") {
      lines.push(`- Source: Medusa MCP (verified)`)
    } else if (schema.source === "code-index") {
      lines.push(`- Source: Codebase analysis (Code-Index)`)
    } else {
      lines.push(`- Source: Static registry`)
    }

    if (schema.apiPath) {
      lines.push(`- API: ${schema.apiPath}`)
    }

    if (schema.relations.length > 0) {
      lines.push(`- Relations: ${schema.relations.join(", ")}`)
    } else {
      lines.push(`- Relations: none`)
    }

    if (schema.filters.length > 0) {
      lines.push(`- Filters: ${schema.filters.join(", ")}`)
    }

    if (config?.description) {
      lines.push(`- Description: ${config.description}`)
    }

    // Include spec-based enum values (critical for query planning!)
    if (spec) {
      const enumFields = spec.dataModel.fields.filter(f => f.enumValues && f.enumValues.length > 0)
      if (enumFields.length > 0) {
        lines.push(`- Enum Fields:`)
        for (const field of enumFields) {
          lines.push(`  - ${field.name}: [${field.enumValues!.join(", ")}]`)
        }
      }

      // Include module links for cross-entity queries
      if (spec.integrationPoints.links.length > 0) {
        lines.push(`- Module Links:`)
        for (const link of spec.integrationPoints.links) {
          lines.push(`  - ${link.sourceEntity} ↔ ${link.targetEntity} (${link.linkType})`)
        }
      }
    }

    // Include code context for custom entities
    if (isCustom && schema.codeContext) {
      const ctx = schema.codeContext

      if (ctx.apiRoutes.length > 0) {
        lines.push(`- API Routes:`)
        ctx.apiRoutes.slice(0, 5).forEach(route => lines.push(`  - ${route}`))
        if (ctx.apiRoutes.length > 5) {
          lines.push(`  - ... and ${ctx.apiRoutes.length - 5} more`)
        }
      }

      if (ctx.serviceMethods.length > 0) {
        lines.push(`- Service Methods: ${ctx.serviceMethods.slice(0, 5).join(", ")}`)
      }

      if (ctx.workflowSteps.length > 0 && ctx.workflowSteps.length <= 10) {
        lines.push(`- Workflow Steps: ${ctx.workflowSteps.join(", ")}`)
      }

      if (ctx.modelFields.length > 0) {
        lines.push(`- Model Fields: ${ctx.modelFields.slice(0, 15).join(", ")}`)
      }
    }

    lines.push("")
  }

  return lines.join("\n")
}

// ============================================
// SEMANTIC SEARCH INTEGRATION
// ============================================

/**
 * Detect relevant modules for a natural language query using semantic search.
 * This helps the query planner understand which modules to focus on.
 *
 * @param query - The natural language query
 * @param maxModules - Maximum number of modules to return (default: 3)
 * @returns Array of relevant module names
 *
 * @example
 * const modules = await detectRelevantModulesForQuery("find designs with active production runs")
 * // Returns: ["production_runs", "designs"]
 */
export async function detectRelevantModulesForQuery(
  query: string,
  maxModules: number = 3
): Promise<string[]> {
  try {
    const modules = await findRelevantModules(query, maxModules)
    console.log(`[DynamicSchema] Detected relevant modules for query: ${modules.join(", ")}`)
    return modules
  } catch (error) {
    console.warn("[DynamicSchema] Semantic search failed, falling back to keyword detection:", error)
    return []
  }
}

/**
 * Get rich spec context for LLM based on a natural language query.
 * Uses semantic search to find relevant modules and builds detailed context.
 *
 * @param query - The natural language query
 * @param maxModules - Maximum number of modules to include (default: 3)
 * @returns LLM-ready context string with relevant entity specs
 */
export async function getSemanticSpecContext(
  query: string,
  maxModules: number = 3
): Promise<string> {
  try {
    return await getSpecContextForLLM(query, maxModules)
  } catch (error) {
    console.warn("[DynamicSchema] Failed to get semantic spec context:", error)
    return ""
  }
}

/**
 * Search for relevant entity specs based on a query.
 * Returns detailed search results with similarity scores.
 *
 * @param query - The natural language query
 * @param topK - Number of results to return (default: 5)
 * @returns Array of spec search results with similarity scores
 */
export async function searchEntitySpecs(
  query: string,
  topK: number = 5
): Promise<SpecSearchResult[]> {
  try {
    return await searchSpecs(query, topK, true)
  } catch (error) {
    console.warn("[DynamicSchema] Spec search failed:", error)
    return []
  }
}

/**
 * Build enhanced LLM context combining dynamic schemas and semantic spec search.
 * This provides the richest context for the query planner.
 *
 * @param query - The natural language query
 * @param detectedEntities - Entities already detected from the query
 * @returns Combined context string
 */
export async function buildEnhancedLLMContext(
  query: string,
  detectedEntities: string[] = []
): Promise<string> {
  const contextParts: string[] = []

  // 1. Get semantic spec context (most relevant based on query)
  const semanticContext = await getSemanticSpecContext(query, 3)
  if (semanticContext) {
    contextParts.push(semanticContext)
    contextParts.push("")
  }

  // 2. Get dynamic schemas for any detected entities not covered by semantic search
  if (detectedEntities.length > 0) {
    const schemas = await fetchSchemasForEntities(detectedEntities)
    const schemaContext = await buildDynamicSchemaForLLM(schemas)
    if (schemaContext) {
      contextParts.push(schemaContext)
    }
  }

  return contextParts.join("\n")
}

// ============================================
// CACHE MANAGEMENT
// ============================================

/**
 * Clear the schema cache (for testing)
 */
export function clearSchemaCache(): void {
  schemaCache.clear()
  console.log("[DynamicSchema] Cache cleared")
}

/**
 * Get cache statistics
 */
export function getSchemaCacheStats(): {
  size: number
  entities: string[]
  oldestEntry: number | null
} {
  const entries = Array.from(schemaCache.entries())
  const oldestEntry = entries.length > 0
    ? Math.min(...entries.map(([, schema]) => schema.fetchedAt))
    : null

  return {
    size: schemaCache.size,
    entities: Array.from(schemaCache.keys()),
    oldestEntry,
  }
}

/**
 * Pre-warm cache for common entities
 *
 * Call this on server startup to avoid cold cache latency
 * for the most frequently queried entities.
 */
export async function prewarmSchemaCache(
  entities: string[] = ["order", "customer", "product", "store", "region"]
): Promise<void> {
  console.log("[DynamicSchema] Pre-warming cache for:", entities)
  await fetchSchemasForEntities(entities)
  console.log("[DynamicSchema] Cache pre-warmed")
}
