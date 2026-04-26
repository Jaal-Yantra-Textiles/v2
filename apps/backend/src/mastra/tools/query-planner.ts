/**
 * Query Planner
 *
 * Uses an LLM to generate multi-step query plans for complex data requests.
 * This enables queries like "orders for customer Saransh Sharma" which require:
 * 1. First query customers to get customer_id
 * 2. Then query orders with that customer_id
 *
 * The LLM analyzes the user query against the entity registry and generates
 * a structured query plan that can be executed step-by-step.
 *
 * Enhanced with entity classification and validation for Phase 8.
 *
 * Phase 13 Enhancements:
 * - Model Parser: Extracts searchable fields, enums, relations from DML schemas
 * - Link Parser: Discovers cross-module connections via defineLink
 * - Route Parser: Maps API endpoints, validators, workflow triggers
 * - Event Chain Parser: Traces side effects through subscribers/workflows
 */

import * as path from "path"
import { generateText } from "ai"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { z } from "@medusajs/framework/zod"
import {
  ENTITY_REGISTRY,
  getEntityConfig,
  CustomEntityConfig,
  CoreEntityConfig,
} from "../schema/entity-registry"
import { buildAPIContextForPlanner } from "../services/medusa-mcp"
import {
  fetchSchemasForEntities,
  buildDynamicSchemaForLLM,
} from "../services/dynamic-schema"
import {
  classifyEntity,
  getResponseExpectation,
  validateRelations,
  buildStepDescription,
  findDependencies,
} from "../services/entity-classifier"
import {
  getModelsForStep,
  isRateLimitError,
  markModelRateLimited,
  markModelSuccess,
  waitForRateLimit,
  waitAfterRateLimit,
} from "../services/model-rotator"
import { queryPlannerLogger as log } from "../services/logger"
import {
  QueryStep,
  QueryPlan,
  EnhancedQueryStep,
  EnhancedQueryPlan,
} from "./types"

// Phase 13: Context parsers for rich codebase awareness
import {
  parseAllModels,
  buildModelDocForLLM,
} from "../services/model-parser"
import {
  parseAllLinks,
  buildLinkDocForLLM,
} from "../services/link-parser"
import {
  parseAllRoutes,
  buildAPIDocForLLM,
  entityToModuleName,
} from "../services/route-parser"
import {
  initializeEventChainParser,
  buildEventContextForLLM,
} from "../services/event-chain-parser"

// Re-export types for backward compatibility
export type { QueryStep, QueryPlan, EnhancedQueryStep, EnhancedQueryPlan }

// Schema for LLM output validation - Phase 13: Expanded to include more operations and fields
const queryPlanSchema = z.object({
  steps: z.array(
    z.object({
      step: z.number(),
      entity: z.string(),
      operation: z.enum(["list", "retrieve", "listAndCount", "count"]),
      filters: z.record(z.any()),
      relations: z.array(z.string()).optional(),
      extract: z.string().optional(),
      linkedFields: z.array(z.string()).optional(), // For Query.graph linked modules
      fields: z.array(z.string()).optional(), // For custom field selection
      executionMethod: z.enum(["http", "module", "graph"]).optional(),
    })
  ),
  finalEntity: z.string(),
  explanation: z.string(),
  // Optional workflow action
  action: z.object({
    type: z.literal("workflow"),
    endpoint: z.string(),
    method: z.enum(["POST", "PUT", "PATCH"]),
    body: z.record(z.any()).optional(),
    workflowName: z.string().optional(),
  }).optional(),
})

// Phase 13: Parser initialization flags
let parsersInitialized = false

/**
 * Initialize all context parsers (called once on first query)
 */
async function ensureParsersInitialized(): Promise<void> {
  if (parsersInitialized) return

  log.time("parser-init")
  log.info("Initializing context parsers...")

  try {
    const projectRoot = process.cwd()

    // Initialize parsers in parallel
    await Promise.all([
      // Model parser for DML schemas
      parseAllModels(path.join(projectRoot, "src/modules")),
      // Link parser for cross-module connections
      parseAllLinks(path.join(projectRoot, "src/links")),
      // Route parser for API endpoints
      parseAllRoutes(path.join(projectRoot, "src/api/admin")),
      // Event chain parser for subscribers/workflows
      initializeEventChainParser(
        path.join(projectRoot, "src/subscribers"),
        path.join(projectRoot, "src/workflows")
      ),
    ])

    parsersInitialized = true
    log.timeEnd("parser-init", "Context parsers initialized")
  } catch (error) {
    log.warn("Failed to initialize some parsers", { error: String(error) })
    // Continue anyway - parsers will return empty results
    parsersInitialized = true
  }
}

/**
 * Build enhanced context from all parsers for detected entities
 */
async function buildEnhancedContext(detectedEntities: string[]): Promise<string> {
  await ensureParsersInitialized()

  const contextParts: string[] = []

  // 1. Model docs for custom entities (searchable fields, enums, relations)
  const customEntityDocs: string[] = []
  for (const entity of detectedEntities) {
    const entityConfig = getEntityConfig(entity)
    if (entityConfig && !entityConfig.is_core) {
      const modelDoc = buildModelDocForLLM(entity)
      if (modelDoc) {
        customEntityDocs.push(modelDoc)
      }

      // Also add link documentation
      const linkDoc = buildLinkDocForLLM(entity)
      if (linkDoc) {
        customEntityDocs.push(linkDoc)
      }
    }
  }

  if (customEntityDocs.length > 0) {
    contextParts.push("## Custom Module Schema (from DML models)\n")
    contextParts.push(customEntityDocs.join("\n\n"))
    contextParts.push("")
  }

  // 2. API route docs for relevant modules
  const detectedModules = new Set<string>()
  for (const entity of detectedEntities) {
    const moduleName = entityToModuleName(entity)
    if (moduleName) {
      detectedModules.add(moduleName)
    }
  }

  if (detectedModules.size > 0) {
    const apiDocs: string[] = []
    for (const module of detectedModules) {
      const doc = buildAPIDocForLLM(module)
      if (doc) {
        apiDocs.push(doc)
      }
    }

    if (apiDocs.length > 0) {
      contextParts.push("\n## Available API Endpoints\n")
      contextParts.push(apiDocs.join("\n"))
    }
  }

  // 3. Event chain context for understanding side effects
  const eventContext = buildEventContextForLLM(detectedEntities)
  if (eventContext) {
    contextParts.push("\n" + eventContext)
  }

  return contextParts.join("\n")
}

/**
 * Validate and sanitize a query plan
 * Removes invalid relations, fixes common LLM mistakes
 */
function validateAndSanitizePlan(plan: QueryPlan): QueryPlan {
  log.debug("Validating and sanitizing plan", { stepCount: plan.steps.length })

  const sanitizedSteps = plan.steps.map((step) => {
    const entityConfig = getEntityConfig(step.entity)

    if (!entityConfig) {
      log.warn("Unknown entity in plan", { entity: step.entity })
      return step
    }

    // Get valid relations for this entity
    const validRelations = entityConfig.is_core
      ? (entityConfig as CoreEntityConfig).relations || []
      : (entityConfig as CustomEntityConfig).relations || []

    // Filter to only valid relations
    const originalRelations = step.relations || []
    const sanitizedRelations = originalRelations.filter((rel) => {
      const isValid = validRelations.includes(rel)
      if (!isValid) {
        log.warn("Removed invalid relation", {
          relation: rel,
          entity: step.entity,
          validRelations,
        })
      }
      return isValid
    })

    // Ensure operation is valid
    const validOperations = ["list", "retrieve", "listAndCount"]
    const operation = validOperations.includes(step.operation) ? step.operation : "list"

    // Phase 14: Remove pagination keys from filters (LLM sometimes adds them incorrectly)
    const paginationKeys = ["limit", "take", "offset", "skip", "page", "pageSize"]
    let sanitizedFilters = step.filters || {}
    const removedKeys: string[] = []

    for (const key of paginationKeys) {
      if (key in sanitizedFilters) {
        removedKeys.push(`${key}=${sanitizedFilters[key]}`)
        const { [key]: _, ...rest } = sanitizedFilters
        sanitizedFilters = rest
      }
    }

    if (removedKeys.length > 0) {
      log.warn("Removed pagination keys from filters", {
        entity: step.entity,
        removedKeys,
        note: "Pagination should be in config, not filters",
      })
    }

    return {
      ...step,
      operation,
      filters: Object.keys(sanitizedFilters).length > 0 ? sanitizedFilters : {},
      relations: sanitizedRelations.length > 0 ? sanitizedRelations : undefined,
    }
  })

  return {
    ...plan,
    steps: sanitizedSteps,
  }
}

/**
 * Build entity schema description for LLM context
 */
function buildEntitySchemaForLLM(): string {
  const lines: string[] = []

  for (const [name, config] of Object.entries(ENTITY_REGISTRY)) {
    lines.push(`\n### ${name}`)
    lines.push(`Description: ${config.description}`)

    if (config.is_core) {
      const coreConfig = config as CoreEntityConfig
      lines.push(`Type: Core Medusa entity (API: ${coreConfig.api_path})`)
      lines.push(`Relations: ${coreConfig.relations?.join(", ") || "none"}`)

      // Add resolvable references if defined
      if (coreConfig.resolvable_refs) {
        lines.push(`Filterable by:`)
        for (const [field, ref] of Object.entries(coreConfig.resolvable_refs)) {
          lines.push(`  - ${field}: resolves from ${ref.entity} (search by: ${ref.search_by.join(", ")})`)
        }
      }
    } else {
      const customConfig = config as CustomEntityConfig
      lines.push(`Type: Custom module`)
      lines.push(`Relations: ${customConfig.relations.join(", ") || "none"}`)

      // Add resolvable references if defined
      if (customConfig.resolvable_refs) {
        lines.push(`Filterable by:`)
        for (const [field, ref] of Object.entries(customConfig.resolvable_refs)) {
          lines.push(`  - ${field}: resolves from ${ref.entity} (search by: ${ref.search_by.join(", ")})`)
        }
      }
    }
  }

  return lines.join("\n")
}

// ─── Dynamic Prompt Template ────────────────────────────────────────────────

/**
 * Query planner prompt template - Phase 14: Dynamic with learned examples
 *
 * Key improvements:
 * 1. Explicit rules about NOT putting pagination in filters
 * 2. Template placeholders for dynamic content ({{EXAMPLES}}, {{CONTEXT}}, {{ENTITY_SCHEMA}})
 * 3. Better error prevention through clear examples
 */
const QUERY_PLANNER_PROMPT_TEMPLATE = `You are a query planner for a textile commerce system built on Medusa.
Your job is to analyze user queries and generate a structured query plan.

## CRITICAL RULES - READ CAREFULLY

1. **Operations**: ONLY use "list", "retrieve", or "listAndCount"
   - NO "count" operation exists - use "list" and count results
   - Use "listAndCount" when you need both data AND total count

2. **Relations**: ONLY use relations explicitly listed for each entity
   - Do NOT invent relations like "contacts" if not in the list
   - If unsure, use NO relations (empty array [])

3. **Reference Syntax**: Use $N for step references
   - $1 = value extracted from step 1
   - $1.id = the id field from step 1's first result

4. **NEVER put pagination in filters**:
   - ❌ WRONG: "filters": { "limit": 5 }
   - ❌ WRONG: "filters": { "take": 10, "status": "active" }
   - ✅ CORRECT: "filters": { "status": "active" }
   - Pagination (limit/take/skip/offset) is handled automatically - just use real filters

5. **Valid filters** are entity field values only:
   - "q" for text search
   - "status", "id", "name", "email", etc. for exact matches
   - Filter foreign keys like "customer_id": "$1"

## Available Entities and Their Relationships

{{ENTITY_SCHEMA}}

{{LEARNED_EXAMPLES}}

## Standard Example Patterns

### Pattern 1: Simple List
Query: "Show me all designs"
\`\`\`json
{
  "steps": [{ "step": 1, "entity": "design", "operation": "list", "filters": {}, "relations": ["specifications", "colors"] }],
  "finalEntity": "design",
  "explanation": "Direct list of designs with valid relations"
}
\`\`\`

### Pattern 2: Search by Name
Query: "Find person named Saransh Sharma"
\`\`\`json
{
  "steps": [{ "step": 1, "entity": "person", "operation": "list", "filters": { "q": "Saransh Sharma" }, "relations": [] }],
  "finalEntity": "person",
  "explanation": "Search persons using q filter"
}
\`\`\`

### Pattern 3: Two-Step Resolution
Query: "Orders for customer Saransh Sharma"
\`\`\`json
{
  "steps": [
    { "step": 1, "entity": "customer", "operation": "list", "filters": { "q": "Saransh Sharma" }, "extract": "id" },
    { "step": 2, "entity": "order", "operation": "list", "filters": { "customer_id": "$1" }, "relations": ["items"] }
  ],
  "finalEntity": "order",
  "explanation": "1. Find customer by name. 2. Get orders using customer_id"
}
\`\`\`

### Pattern 4: Filter by Status (NOT by limit!)
Query: "List 5 active partners"
\`\`\`json
{
  "steps": [{ "step": 1, "entity": "partner", "operation": "list", "filters": { "status": "active" }, "relations": [] }],
  "finalEntity": "partner",
  "explanation": "Filter by status. Pagination handled automatically."
}
\`\`\`

### Pattern 5: Linked Module Data
Query: "List raw materials with inventory items"
\`\`\`json
{
  "steps": [{
    "step": 1,
    "entity": "raw_material",
    "operation": "list",
    "filters": {},
    "relations": [],
    "linkedFields": ["inventory_item.*"]
  }],
  "finalEntity": "raw_material",
  "explanation": "Fetch with linked inventory data via Query.graph"
}
\`\`\`

{{ADDITIONAL_CONTEXT}}

## Output Format

Respond with ONLY a JSON object (no markdown code blocks, no explanation outside JSON):
{
  "steps": [...],
  "finalEntity": "entity_name",
  "explanation": "Brief explanation"
}

Now generate a query plan for:
`

import { getSimilarExamples, searchSpecDocuments } from "../services/plan-store"

/**
 * Build a dynamic prompt for the query planner using:
 * 1. Similar examples from the plan store (learned from successful queries)
 * 2. Entity schema from the registry
 * 3. Additional context from parsers
 *
 * @param query - The user's query
 * @param entities - Detected entities
 * @param additionalContext - Context from codebase parsers, MCP, etc.
 */
async function buildDynamicPrompt(
  query: string,
  entities: string[],
  additionalContext: string = ""
): Promise<string> {
  // 1. Get similar examples from plan store
  let learnedExamplesSection = ""
  try {
    log.debug("Fetching similar examples from plan store...")
    const { formattedText, examples } = await getSimilarExamples(query, 3, 0.5)
    if (formattedText) {
      learnedExamplesSection = formattedText
      log.info("Found similar examples", { count: examples.length })
    }
  } catch (error) {
    log.warn("Could not fetch similar examples", { error: String(error) })
  }

  // 2. Search for relevant spec documents
  let specContext = ""
  if (entities.length > 0) {
    try {
      log.debug("Searching for spec documents...", { entities })
      const specs = await searchSpecDocuments(query, 2)
      if (specs.length > 0) {
        specContext = "\n## Relevant Module Documentation\n\n" +
          specs.map(s => `### ${s.specName}\n${s.content.slice(0, 2000)}`).join("\n\n")
        log.info("Found relevant specs", { count: specs.length, names: specs.map(s => s.specName) })
      }
    } catch (error) {
      log.warn("Could not fetch spec documents", { error: String(error) })
    }
  }

  // 3. Build the entity schema section
  const entitySchemaSection = buildEntitySchemaForLLM()

  // 4. Combine additional context
  const combinedContext = [additionalContext, specContext].filter(Boolean).join("\n\n")

  // 5. Build the final prompt from template
  return QUERY_PLANNER_PROMPT_TEMPLATE
    .replace("{{ENTITY_SCHEMA}}", entitySchemaSection)
    .replace("{{LEARNED_EXAMPLES}}", learnedExamplesSection || "")
    .replace("{{ADDITIONAL_CONTEXT}}", combinedContext ? `## Additional Context\n\n${combinedContext}` : "")
}

// Keep the old static prompt as a fallback
const QUERY_PLANNER_PROMPT_STATIC = `You are a query planner for a textile commerce system built on Medusa.
Your job is to analyze user queries and generate a structured query plan.

## CRITICAL RULES

1. **ONLY use these operations**: "list", "retrieve", "listAndCount"
   - There is NO "count" operation - use "list" and count the results
   - Use "listAndCount" when you need both data AND total count

2. **ONLY use relations listed for each entity**
   - Do NOT invent relations like "contacts" if not listed
   - If unsure, use NO relations (empty array)

3. **Use $N syntax for step references**
   - $1 = first result from step 1
   - $1.id = the id field from step 1's first result

4. **NEVER put pagination (limit/take/offset/skip) in filters**
   - ❌ WRONG: "filters": { "limit": 5, "status": "active" }
   - ✅ CORRECT: "filters": { "status": "active" }
   - Pagination is handled automatically by the executor

## Available Entities and Their Relationships
${buildEntitySchemaForLLM()}

## Example Patterns

### Pattern 1: Simple List
Query: "Show me all designs"
{"steps": [{ "step": 1, "entity": "design", "operation": "list", "filters": {}, "relations": ["specifications", "colors"] }], "finalEntity": "design", "explanation": "Direct list"}

### Pattern 2: Search by Name
Query: "Find person named Saransh"
{"steps": [{ "step": 1, "entity": "person", "operation": "list", "filters": { "q": "Saransh" }, "relations": [] }], "finalEntity": "person", "explanation": "Search using q filter"}

### Pattern 3: Two-Step Resolution
Query: "Orders for customer John"
{"steps": [{ "step": 1, "entity": "customer", "operation": "list", "filters": { "q": "John" }, "extract": "id" }, { "step": 2, "entity": "order", "operation": "list", "filters": { "customer_id": "$1" }, "relations": ["items"] }], "finalEntity": "order", "explanation": "Find customer, then orders"}

### Pattern 4: Filter by Status (NOT limit!)
Query: "List 5 active partners"
{"steps": [{ "step": 1, "entity": "partner", "operation": "list", "filters": { "status": "active" }, "relations": [] }], "finalEntity": "partner", "explanation": "Filter by status only"}

## Output Format

Respond with ONLY a JSON object:
{"steps": [...], "finalEntity": "entity_name", "explanation": "Brief explanation"}

Now generate a query plan for:
`

/**
 * Generate a query plan using LLM with model rotation
 *
 * Uses the model rotator service to avoid rate limits by using
 * different models for query planning vs other workflow steps.
 *
 * Phase 13: Enhanced with codebase context from parsers (models, links, routes, events)
 *
 * @param userQuery - The user's natural language query
 * @param detectedEntities - Entities already detected from the query
 * @param useMCPContext - Whether to fetch Medusa MCP docs for context (default: true)
 * @param requestId - Optional request ID for model usage tracking
 * @returns Query plan with steps to execute
 */
export async function generateQueryPlan(
  userQuery: string,
  detectedEntities: string[] = [],
  useMCPContext: boolean = true,
  requestId?: string
): Promise<QueryPlan> {
  log.operationStart("Generate Query Plan", {
    query: userQuery.slice(0, 100),
    entities: detectedEntities,
    useMCPContext,
  })

  // Phase 13: Build enhanced context from codebase parsers
  let enhancedCodebaseContext = ""
  if (detectedEntities.length > 0) {
    try {
      log.debug("Building enhanced codebase context...", { entities: detectedEntities })
      enhancedCodebaseContext = await buildEnhancedContext(detectedEntities)
      if (enhancedCodebaseContext) {
        log.debug("Got enhanced context", { length: enhancedCodebaseContext.length })
      }
    } catch (error) {
      log.warn("Failed to build enhanced context", { error: String(error) })
    }
  }

  // Phase 10: Fetch dynamic schemas BEFORE generating the plan
  // This gives the LLM accurate relation information to prevent invalid plans
  let dynamicSchemaContext = ""
  if (useMCPContext && detectedEntities.length > 0) {
    try {
      log.debug("Fetching dynamic schemas...", { entities: detectedEntities })
      const schemas = await fetchSchemasForEntities(detectedEntities)
      dynamicSchemaContext = buildDynamicSchemaForLLM(schemas)
      if (dynamicSchemaContext) {
        log.info("Got dynamic schema context", { entityCount: schemas.size })
      }
    } catch (error) {
      log.warn("Failed to fetch dynamic schemas", { error: String(error) })
      // Continue without dynamic schema context
    }
  }

  // Also fetch Medusa API documentation from MCP for filter context
  let mcpContext = ""
  if (useMCPContext && detectedEntities.length > 0) {
    try {
      log.debug("Fetching Medusa MCP context...", { entities: detectedEntities })
      mcpContext = await buildAPIContextForPlanner(detectedEntities)
      if (mcpContext) {
        log.debug("Got MCP context", { length: mcpContext.length })
      }
    } catch (error) {
      log.warn("Failed to fetch MCP context", { error: String(error) })
      // Continue without MCP context
    }
  }

  // Phase 14: Build dynamic prompt with learned examples and context
  // Combine all context sources for the dynamic prompt builder
  const combinedAdditionalContext = [
    enhancedCodebaseContext,
    dynamicSchemaContext,
    mcpContext,
  ].filter(Boolean).join("\n\n")

  let fullPrompt: string
  try {
    // Try the new dynamic prompt with learned examples
    log.debug("Building dynamic prompt with learned examples...")
    fullPrompt = await buildDynamicPrompt(userQuery, detectedEntities, combinedAdditionalContext)
    fullPrompt += "\n\nUser Query: " + userQuery
    log.info("Dynamic prompt built successfully", { promptLength: fullPrompt.length })
  } catch (error) {
    // Fall back to static prompt if dynamic fails
    log.warn("Failed to build dynamic prompt, using static", { error: String(error) })
    const contextParts: string[] = [QUERY_PLANNER_PROMPT_STATIC]
    if (combinedAdditionalContext) {
      contextParts.push("\n\n## Additional Context\n")
      contextParts.push(combinedAdditionalContext)
    }
    contextParts.push("\n\nUser Query: " + userQuery)
    fullPrompt = contextParts.join("")
  }

  // Get models assigned to query planning step
  const models = await getModelsForStep("query_planning", requestId)
  log.info("Models assigned for query planning", { models })

  // Try each model until one succeeds
  for (const modelId of models) {
    try {
      // Phase 14: Wait for rate limit protection before LLM call
      await waitForRateLimit()

      log.debug("Trying model for query planning", { model: modelId })

      const openrouter = createOpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY,
      })

      const { text } = await generateText({
        model: openrouter(modelId) as any,
        prompt: fullPrompt,
        temperature: 0.1, // Low temperature for more deterministic output
      })

      // Parse the JSON response
      const cleanedText = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
      log.debug("Raw LLM response", { responseLength: text.length })

      const parsed = JSON.parse(cleanedText)

      // Validate against schema
      const validated = queryPlanSchema.parse(parsed)

      // Phase 13: Sanitize the plan (remove invalid relations, fix common mistakes)
      const sanitized = validateAndSanitizePlan(validated as QueryPlan)

      // Mark model as successful
      markModelSuccess(modelId)

      log.operationEnd("Generate Query Plan", true, {
        model: modelId,
        steps: sanitized.steps.length,
        finalEntity: sanitized.finalEntity,
      })
      log.debug("Generated plan details", sanitized)

      return sanitized
    } catch (error) {
      log.warn("Model failed for query planning", {
        model: modelId,
        error: error instanceof Error ? error.message : String(error),
      })

      // Check if rate limited and mark accordingly
      if (isRateLimitError(error)) {
        markModelRateLimited(modelId)
        // Phase 14: Wait extra time after rate limit before trying next model
        await waitAfterRateLimit()
      }

      continue
    }
  }

  // Fallback: Generate a simple single-step plan based on detected entities
  log.warn("All models failed, using fallback plan")
  log.operationEnd("Generate Query Plan", false, { reason: "fallback" })
  return generateFallbackPlan(userQuery, detectedEntities)
}

/**
 * Generate a simple fallback plan when LLM fails
 */
function generateFallbackPlan(userQuery: string, detectedEntities: string[]): QueryPlan {
  // Use the first detected entity, or default to a general search
  const primaryEntity = detectedEntities[0] || "order"
  const config = getEntityConfig(primaryEntity)

  // Extract any names/search terms from the query
  const namePatterns = [
    /for\s+(?:customer|partner|person|design)?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
    /["']([^"']+)["']/,
  ]

  let searchTerm: string | undefined
  for (const pattern of namePatterns) {
    const match = userQuery.match(pattern)
    if (match) {
      searchTerm = match[1]
      break
    }
  }

  const filters: Record<string, any> = {}
  if (searchTerm) {
    filters.q = searchTerm
  }

  const relations = config?.is_core
    ? (config as CoreEntityConfig).relations?.slice(0, 3) || []
    : (config as CustomEntityConfig)?.relations?.slice(0, 3) || []

  return {
    steps: [
      {
        step: 1,
        entity: primaryEntity,
        operation: "list",
        filters,
        relations,
      },
    ],
    finalEntity: primaryEntity,
    explanation: "Fallback: Direct query with search term",
  }
}

/**
 * Check if a query plan requires reference resolution
 */
export function planRequiresResolution(plan: QueryPlan): boolean {
  return plan.steps.length > 1
}

/**
 * Get the entities involved in a query plan
 */
export function getPlanEntities(plan: QueryPlan): string[] {
  return [...new Set(plan.steps.map((s) => s.entity))]
}

// ============================================
// ENHANCED QUERY PLAN (Phase 8)
// ============================================

/**
 * Enrich a basic query plan with entity classification and validation
 *
 * This function takes the LLM-generated plan and adds:
 * - Entity classification (Core vs Custom)
 * - Response expectations (wrapper keys, required fields)
 * - Validation criteria (for step evaluation)
 * - Step descriptions (for logging)
 * - Dependencies (which steps depend on which)
 *
 * @param plan - Basic query plan from LLM
 * @returns Enhanced query plan with classification metadata
 */
export function enrichPlanWithClassification(plan: QueryPlan): EnhancedQueryPlan {
  const coreEntities: string[] = []
  const customEntities: string[] = []

  log.info("Enriching plan with classification", { steps: plan.steps.length })

  const enrichedSteps: EnhancedQueryStep[] = plan.steps.map((step) => {
    // Get entity classification
    const classification = classifyEntity(step.entity)

    if (!classification) {
      log.warn("Unknown entity, using fallback classification", { entity: step.entity })
    }

    // Track which type of entity
    if (classification?.isCore) {
      if (!coreEntities.includes(step.entity)) {
        coreEntities.push(step.entity)
      }
    } else {
      if (!customEntities.includes(step.entity)) {
        customEntities.push(step.entity)
      }
    }

    // Validate and filter relations to only valid ones
    const { valid: validRelations, invalid: invalidRelations } = validateRelations(
      step.entity,
      step.relations
    )

    if (invalidRelations.length > 0) {
      log.warn("Removed invalid relations from step", {
        step: step.step,
        entity: step.entity,
        invalidRelations,
      })
    }

    // Build response expectation
    const responseExpectation = getResponseExpectation(
      step.entity,
      classification?.isCore ?? false
    )

    // Build validation criteria
    const validation = {
      requireNonEmpty: step.extract !== undefined, // Extraction steps need results
      requireFields: ["id"], // All entities should have id
      extractField: step.extract,
      extractValidation: step.extract
        ? { notNull: true, type: "string" as const }
        : undefined,
    }

    // Build step description
    const description = buildStepDescription(
      step.entity,
      step.operation,
      step.filters,
      classification
    )

    // Find dependencies (which steps this step depends on)
    const dependsOn = findDependencies(step.filters)

    const enrichedStep: EnhancedQueryStep = {
      ...step,
      relations: validRelations, // Only valid relations
      classification: classification || {
        entityName: step.entity,
        isCore: false,
        executionMethod: "module",
        validRelations: [],
      },
      responseExpectation,
      validation,
      description,
      dependsOn,
    }

    log.debug("Step enriched", {
      step: step.step,
      entity: step.entity,
      type: classification?.isCore ? "CORE" : "CUSTOM",
      description,
    })

    return enrichedStep
  })

  const enhancedPlan: EnhancedQueryPlan = {
    ...plan,
    steps: enrichedSteps,
    coreEntitiesInvolved: coreEntities,
    customEntitiesInvolved: customEntities,
  }

  log.info("Plan enriched successfully", {
    steps: enhancedPlan.steps.length,
    coreEntities: coreEntities.length > 0 ? coreEntities : "(none)",
    customEntities: customEntities.length > 0 ? customEntities : "(none)",
  })

  return enhancedPlan
}

/**
 * Generate an enhanced query plan (combines LLM generation with enrichment)
 *
 * @param userQuery - The user's natural language query
 * @param detectedEntities - Entities already detected from the query
 * @param useMCPContext - Whether to fetch Medusa MCP docs for context
 * @returns Enhanced query plan with classification and validation
 */
export async function generateEnhancedQueryPlan(
  userQuery: string,
  detectedEntities: string[] = [],
  useMCPContext: boolean = true
): Promise<EnhancedQueryPlan> {
  // Generate basic plan using LLM
  const basicPlan = await generateQueryPlan(userQuery, detectedEntities, useMCPContext)

  // Enrich with classification and validation
  return enrichPlanWithClassification(basicPlan)
}
