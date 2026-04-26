/**
 * Spec Store Service
 *
 * Stores and retrieves module specifications using PgVector for semantic search.
 * This enables the AI query planner to find relevant entity specs based on
 * natural language queries.
 *
 * Key features:
 * - Stores module spec summaries as embeddings
 * - Semantic search for finding relevant modules for a query
 * - Caches embeddings to avoid regeneration
 * - Integrates with spec-loader.ts
 * - Dynamic spec generation from container introspection (NEW)
 * - Chunked loading for large specs (NEW)
 * - Enhanced natural language examples for better matching (NEW)
 */

// @ts-nocheck
import { PgVector } from "@mastra/pg"
import {
  embedText,
  embedTexts,
  classifyMatch,
  EMBEDDING_CONFIG,
} from "./embedding-service"
import {
  loadAllSpecs,
  loadModuleSpec,
  buildLLMContextFromSpec,
  ModuleSpec,
} from "./spec-loader"

// ─── Enhanced Natural Language Patterns ──────────────────────────────────────

/**
 * Common query prefixes that users naturally use.
 * These will be added to searchable text to improve semantic matching.
 */
const NATURAL_QUERY_PREFIXES = [
  "fetch all",
  "get all",
  "show me",
  "list all",
  "find all",
  "retrieve all",
  "display all",
  "show all",
  "give me",
  "pull all",
  "load all",
]

/**
 * Generate natural language examples for a module.
 * These cover common ways users might phrase queries.
 */
function generateNaturalLanguageExamples(
  moduleName: string,
  entityName: string,
  linkedEntities: string[] = []
): string[] {
  const examples: string[] = []
  const singular = entityName.replace(/s$/, "").toLowerCase()
  const plural = entityName.toLowerCase()

  // Basic queries with various prefixes
  for (const prefix of NATURAL_QUERY_PREFIXES) {
    examples.push(`${prefix} ${plural}`)
  }

  // Singular queries
  examples.push(`get ${singular}`, `find ${singular}`, `show ${singular}`)

  // "that have" patterns for linked entities
  for (const linked of linkedEntities.slice(0, 5)) {
    const linkedLower = linked.toLowerCase()
    examples.push(
      `${plural} that have ${linkedLower}`,
      `${plural} with ${linkedLower}`,
      `fetch all ${plural} that have ${linkedLower}`,
      `get ${plural} with their ${linkedLower}`,
      `show me ${plural} with ${linkedLower}`,
      `find ${plural} that have ${linkedLower}`,
      // Reverse patterns - "X for Y"
      `${linkedLower} for ${plural}`,
      `${linkedLower} for ${singular}`,
      `get ${linkedLower} for ${plural}`,
      `find ${linkedLower} for ${singular}`,
      `show ${linkedLower} for ${plural}`
    )
  }

  return examples
}

// ─── Configuration ───────────────────────────────────────────────────────────

const INDEX_NAME = process.env.AI_SPEC_STORE_INDEX || "ai_module_specs"
const EMBEDDING_DIM = EMBEDDING_CONFIG.dimension

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SpecEmbeddingMetadata {
  moduleName: string
  entityName: string
  tableName: string
  description: string
  fieldNames: string[]
  relationNames: string[]
  enumFields: Array<{ name: string; values: string[] }>
  linkedModules: string[]
  workflowNames: string[]
  searchableText: string // Combined text used for embedding
  updatedAt: string
  // NEW: Query intelligence
  inferredRelations?: Array<{
    fieldName: string
    targetEntity: string
    targetModule: string
  }>
  queryPatterns?: Array<{
    description: string
    primaryEntity: string
    naturalLanguageExamples: string[]
  }>
  semanticMappings?: Record<string, Record<string, string[]>> // fieldName -> enumValue -> userTerms
}

export interface SpecSearchResult {
  moduleName: string
  metadata: SpecEmbeddingMetadata
  similarity: number
  matchType: "high" | "moderate" | "low"
  spec?: ModuleSpec
}

// ─── PgVector Setup ──────────────────────────────────────────────────────────

let pgVectorInstance: PgVector | null = null

function getPgVector(): PgVector {
  if (pgVectorInstance) {
    return pgVectorInstance
  }

  const conn =
    process.env.POSTGRES_CONNECTION_STRING || process.env.DATABASE_URL
  if (!conn) {
    throw new Error(
      "Missing POSTGRES_CONNECTION_STRING or DATABASE_URL for spec store"
    )
  }

  pgVectorInstance = new PgVector({ connectionString: conn })
  return pgVectorInstance
}

async function ensureIndexExists(): Promise<void> {
  const store = getPgVector()

  try {
    let exists = false
    try {
      const indexes = await store.listIndexes?.()
      if (Array.isArray(indexes)) {
        exists = indexes.includes(INDEX_NAME)
      }
    } catch {}

    if (!exists) {
      try {
        await store.createIndex?.({
          indexName: INDEX_NAME,
          dimension: EMBEDDING_DIM,
          metric: "cosine",
        })
        console.log(`[spec-store] Created index: ${INDEX_NAME}`)
      } catch {
        await store.createIndex?.(INDEX_NAME, EMBEDDING_DIM, "cosine")
        console.log(`[spec-store] Created index: ${INDEX_NAME}`)
      }
    }
  } catch (e: any) {
    console.warn("[spec-store] Index setup warning:", e?.message)
  }
}

// ─── Searchable Text Generation ──────────────────────────────────────────────

/**
 * Build a searchable text representation of a module spec.
 * This text is used to generate the embedding for semantic search.
 *
 * IMPORTANT: This text must include natural language patterns that users
 * would actually type, not just technical metadata!
 */
function buildSearchableText(spec: ModuleSpec): string {
  const parts: string[] = []

  // Module identity
  parts.push(`Module: ${spec.module}`)
  parts.push(`Entity: ${spec.dataModel.entityName}`)
  parts.push(`Table: ${spec.dataModel.tableName}`)

  // Description
  if (spec.dataModel.description) {
    parts.push(spec.dataModel.description)
  }

  // Fields (important for queries like "find by status")
  const fieldNames = spec.dataModel.fields.map((f) => f.name)
  parts.push(`Fields: ${fieldNames.join(", ")}`)

  // Enum fields with values (critical for queries like "active production runs")
  const enumFields = spec.dataModel.fields.filter(
    (f) => f.enumValues && f.enumValues.length > 0
  )
  for (const field of enumFields) {
    parts.push(`${field.name} values: ${field.enumValues!.join(", ")}`)
  }

  // Relations (for queries like "designs with specifications")
  if (spec.dataModel.relations.length > 0) {
    const relationNames = spec.dataModel.relations.map((r) => r.name)
    parts.push(`Relations: ${relationNames.join(", ")}`)
  }

  // Module links (for cross-entity queries)
  const linkedEntities: string[] = []
  if (spec.integrationPoints.links.length > 0) {
    const linkTargets = spec.integrationPoints.links.map((l) => l.targetEntity)
    linkedEntities.push(...linkTargets)
    parts.push(`Links to: ${linkTargets.join(", ")}`)
  }

  // Workflows (for action queries)
  if (spec.workflows.definitions.length > 0) {
    const workflowNames = spec.workflows.definitions.map((w) => w.name)
    parts.push(`Workflows: ${workflowNames.join(", ")}`)
  }

  // Business intelligence context
  if (spec.businessIntelligence.businessProcesses.length > 0) {
    const processNames = spec.businessIntelligence.businessProcesses.map(
      (p) => p.name
    )
    parts.push(`Processes: ${processNames.join(", ")}`)
  }

  // NEW: Query intelligence - cross-entity patterns (CRITICAL for RAG)
  const queryIntelligence = (spec as any).queryIntelligence
  if (queryIntelligence?.crossEntityPatterns?.length > 0) {
    parts.push("Cross-entity query patterns:")
    for (const pattern of queryIntelligence.crossEntityPatterns) {
      // Add the description
      parts.push(pattern.description)
      // Add natural language examples (these are what users will type!)
      if (pattern.naturalLanguageExamples?.length > 0) {
        parts.push(pattern.naturalLanguageExamples.join(", "))
      }
    }
  }

  // NEW: Semantic mappings (e.g., "active" -> "in_progress")
  if (queryIntelligence?.semanticMappings?.length > 0) {
    for (const mapping of queryIntelligence.semanticMappings) {
      // Add user terms as searchable text
      for (const [enumValue, userTerms] of Object.entries(mapping.userTerms)) {
        if (Array.isArray(userTerms) && userTerms.length > 0) {
          parts.push(`${mapping.fieldName} ${enumValue}: ${userTerms.join(", ")}`)
        }
      }
    }
  }

  // NEW: Inferred relations from foreign keys
  const inferredRelations = (spec as any).dataModel?.inferredRelations
  if (inferredRelations?.length > 0) {
    parts.push("Inferred relations:")
    for (const rel of inferredRelations) {
      parts.push(`${rel.fieldName} links to ${rel.targetEntity}`)
      if (rel.queryPattern) {
        parts.push(rel.queryPattern)
      }
    }
  }

  // NEW: Generated natural language examples (CRITICAL for semantic matching!)
  // This covers common phrasings like "fetch all", "get all", "show me"
  const nlExamples = generateNaturalLanguageExamples(
    spec.module,
    spec.dataModel.entityName,
    linkedEntities
  )
  if (nlExamples.length > 0) {
    parts.push("Common queries:")
    parts.push(nlExamples.join(", "))
  }

  return parts.join(". ")
}

/**
 * Build metadata for a module spec embedding.
 */
function buildSpecMetadata(spec: ModuleSpec): SpecEmbeddingMetadata {
  const specAny = spec as any

  // Extract inferred relations
  const inferredRelations = specAny.dataModel?.inferredRelations?.map((r: any) => ({
    fieldName: r.fieldName,
    targetEntity: r.targetEntity,
    targetModule: r.targetModule,
  }))

  // Extract query patterns
  const queryPatterns = specAny.queryIntelligence?.crossEntityPatterns?.map((p: any) => ({
    description: p.description,
    primaryEntity: p.primaryEntity,
    naturalLanguageExamples: p.naturalLanguageExamples || [],
  }))

  // Extract semantic mappings
  const semanticMappings: Record<string, Record<string, string[]>> = {}
  if (specAny.queryIntelligence?.semanticMappings) {
    for (const mapping of specAny.queryIntelligence.semanticMappings) {
      semanticMappings[mapping.fieldName] = mapping.userTerms
    }
  }

  return {
    moduleName: spec.module,
    entityName: spec.dataModel.entityName,
    tableName: spec.dataModel.tableName,
    description: spec.dataModel.description || "",
    fieldNames: spec.dataModel.fields.map((f) => f.name),
    relationNames: spec.dataModel.relations.map((r) => r.name),
    enumFields: spec.dataModel.fields
      .filter((f) => f.enumValues && f.enumValues.length > 0)
      .map((f) => ({ name: f.name, values: f.enumValues! })),
    linkedModules: spec.integrationPoints.links.map((l) => l.targetModule),
    workflowNames: spec.workflows.definitions.map((w) => w.name),
    searchableText: buildSearchableText(spec),
    updatedAt: new Date().toISOString(),
    // NEW: Query intelligence
    inferredRelations: inferredRelations?.length > 0 ? inferredRelations : undefined,
    queryPatterns: queryPatterns?.length > 0 ? queryPatterns : undefined,
    semanticMappings: Object.keys(semanticMappings).length > 0 ? semanticMappings : undefined,
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialize the spec store.
 * Call this at startup to ensure the index exists.
 */
export async function initSpecStore(): Promise<void> {
  await ensureIndexExists()
}

/**
 * Store a single module spec embedding.
 *
 * @param spec - The module specification to store
 * @returns The module name (used as ID)
 */
export async function storeSpec(spec: ModuleSpec): Promise<string> {
  await ensureIndexExists()

  const store = getPgVector()
  const id = `spec_${spec.module}`

  const searchableText = buildSearchableText(spec)
  const embedding = await embedText(searchableText)
  const metadata = buildSpecMetadata(spec)

  await store.upsert({
    indexName: INDEX_NAME,
    vectors: [embedding],
    ids: [id],
    metadata: [metadata],
  })

  console.log(`[spec-store] Stored spec: ${spec.module} (${searchableText.length} chars)`)
  return id
}

/**
 * Store all available module specs.
 * Loads specs from the specs/ directory and stores their embeddings.
 *
 * @returns Number of specs stored
 */
export async function storeAllSpecs(): Promise<number> {
  await ensureIndexExists()

  const specs = await loadAllSpecs()
  if (specs.size === 0) {
    console.log("[spec-store] No specs found to store")
    return 0
  }

  const store = getPgVector()
  const ids: string[] = []
  const texts: string[] = []
  const metadataList: SpecEmbeddingMetadata[] = []

  for (const [moduleName, spec] of specs) {
    ids.push(`spec_${moduleName}`)
    texts.push(buildSearchableText(spec))
    metadataList.push(buildSpecMetadata(spec))
  }

  // Generate embeddings in batch
  console.log(`[spec-store] Generating embeddings for ${texts.length} specs...`)
  const embeddings = await embedTexts(texts)

  await store.upsert({
    indexName: INDEX_NAME,
    vectors: embeddings,
    ids,
    metadata: metadataList,
  })

  console.log(`[spec-store] Stored ${specs.size} module specs`)
  return specs.size
}

// ─── Dynamic Spec Generation ─────────────────────────────────────────────────

/**
 * Generate and store a spec dynamically from container introspection.
 * This is called when no pre-generated spec file exists.
 *
 * @param moduleName - The module name to generate spec for
 * @returns The generated and stored spec, or null if generation failed
 */
export async function generateAndStoreSpec(moduleName: string): Promise<ModuleSpec | null> {
  try {
    // First try to load from file (may trigger on-the-fly generation in spec-loader)
    const spec = await loadModuleSpec(moduleName)
    if (!spec) {
      console.warn(`[spec-store] Could not generate spec for: ${moduleName}`)
      return null
    }

    // Store the dynamically generated spec
    await storeSpec(spec)
    console.log(`[spec-store] Generated and stored spec dynamically: ${moduleName}`)

    return spec
  } catch (error) {
    console.error(`[spec-store] Failed to generate spec for ${moduleName}:`, error)
    return null
  }
}

/**
 * Store specs dynamically from a list of module names.
 * Uses container introspection + on-the-fly generation.
 *
 * @param moduleNames - Array of module names to process
 * @returns Number of specs stored successfully
 */
export async function storeDynamicSpecs(moduleNames: string[]): Promise<number> {
  await ensureIndexExists()

  let stored = 0
  for (const moduleName of moduleNames) {
    const result = await generateAndStoreSpec(moduleName)
    if (result) stored++
  }

  console.log(`[spec-store] Stored ${stored}/${moduleNames.length} dynamic specs`)
  return stored
}

// ─── Chunked Loading ─────────────────────────────────────────────────────────

/**
 * Configuration for chunked loading.
 */
const CHUNK_SIZE = parseInt(process.env.AI_SPEC_CHUNK_SIZE || "15", 10) // Default: 15 specs per chunk

/**
 * Store specs in chunks to handle large numbers of specs efficiently.
 * This prevents memory issues and allows for progress tracking.
 *
 * @param chunkSize - Number of specs to process at once (default: 15)
 * @param onProgress - Optional callback for progress updates
 * @returns Total number of specs stored
 */
export async function storeAllSpecsChunked(
  chunkSize: number = CHUNK_SIZE,
  onProgress?: (stored: number, total: number, currentChunk: string[]) => void
): Promise<number> {
  await ensureIndexExists()

  const specs = await loadAllSpecs()
  if (specs.size === 0) {
    console.log("[spec-store] No specs found to store")
    return 0
  }

  const store = getPgVector()
  const allEntries = Array.from(specs.entries())
  const totalSpecs = allEntries.length
  let totalStored = 0

  console.log(`[spec-store] Storing ${totalSpecs} specs in chunks of ${chunkSize}...`)

  // Process in chunks
  for (let i = 0; i < allEntries.length; i += chunkSize) {
    const chunk = allEntries.slice(i, i + chunkSize)
    const chunkModuleNames = chunk.map(([name]) => name)

    console.log(`[spec-store] Processing chunk ${Math.floor(i / chunkSize) + 1}: ${chunkModuleNames.join(", ")}`)

    const ids: string[] = []
    const texts: string[] = []
    const metadataList: SpecEmbeddingMetadata[] = []

    for (const [moduleName, spec] of chunk) {
      ids.push(`spec_${moduleName}`)
      texts.push(buildSearchableText(spec))
      metadataList.push(buildSpecMetadata(spec))
    }

    // Generate embeddings for this chunk
    const embeddings = await embedTexts(texts)

    await store.upsert({
      indexName: INDEX_NAME,
      vectors: embeddings,
      ids,
      metadata: metadataList,
    })

    totalStored += chunk.length

    // Call progress callback if provided
    if (onProgress) {
      onProgress(totalStored, totalSpecs, chunkModuleNames)
    }
  }

  console.log(`[spec-store] Stored ${totalStored} specs in ${Math.ceil(totalSpecs / chunkSize)} chunks`)
  return totalStored
}

/**
 * Get spec context for LLM in chunks.
 * Instead of loading all relevant specs at once, loads a limited number
 * to prevent context overload.
 *
 * @param query - The natural language query
 * @param maxSpecs - Maximum number of specs to include (default: 3)
 * @param maxFieldsPerSpec - Maximum fields to include per spec (default: 20)
 * @returns Chunked LLM context from relevant specs
 */
export async function getChunkedSpecContextForLLM(
  query: string,
  maxSpecs: number = 3,
  maxFieldsPerSpec: number = 20
): Promise<string> {
  const results = await searchSpecs(query, maxSpecs, true)

  if (results.length === 0) {
    return ""
  }

  const contextParts: string[] = [
    "## Relevant Module Specifications",
    "",
    `Found ${results.length} relevant module(s). Showing most relevant details:`,
    "",
  ]

  for (const result of results) {
    const matchLabel =
      result.matchType === "high"
        ? "HIGH RELEVANCE"
        : result.matchType === "moderate"
        ? "MODERATE RELEVANCE"
        : "LOW RELEVANCE"

    contextParts.push(`### ${result.moduleName} (${matchLabel} - ${(result.similarity * 100).toFixed(1)}%)`)

    if (result.spec) {
      // Build chunked context (limit fields, relations, etc.)
      const spec = result.spec
      const lines: string[] = []

      lines.push(`**Entity:** ${spec.dataModel.entityName} (table: ${spec.dataModel.tableName})`)

      // Limit fields
      const fields = spec.dataModel.fields.slice(0, maxFieldsPerSpec)
      if (fields.length > 0) {
        lines.push(`**Fields (showing ${fields.length}/${spec.dataModel.fields.length}):**`)
        for (const field of fields) {
          let fieldLine = `- ${field.name}: ${field.type}`
          if (field.enumValues && field.enumValues.length > 0) {
            fieldLine += ` [${field.enumValues.slice(0, 5).join(", ")}${field.enumValues.length > 5 ? "..." : ""}]`
          }
          lines.push(fieldLine)
        }
      }

      // Show relations (limit to 5)
      const relations = spec.dataModel.relations.slice(0, 5)
      if (relations.length > 0) {
        lines.push(`**Relations (showing ${relations.length}/${spec.dataModel.relations.length}):**`)
        for (const rel of relations) {
          lines.push(`- ${rel.name}: ${rel.cardinality} → ${rel.targetEntity}`)
        }
      }

      // Show module links (limit to 5)
      const links = spec.integrationPoints.links.slice(0, 5)
      if (links.length > 0) {
        lines.push(`**Module Links (showing ${links.length}/${spec.integrationPoints.links.length}):**`)
        for (const link of links) {
          lines.push(`- ${link.sourceEntity} ↔ ${link.targetEntity}`)
        }
      }

      // Show query patterns from queryIntelligence (limit to 3)
      const specAny = spec as any
      if (specAny.queryIntelligence?.crossEntityPatterns?.length > 0) {
        const patterns = specAny.queryIntelligence.crossEntityPatterns.slice(0, 3)
        lines.push(`**Query Patterns (showing ${patterns.length}):**`)
        for (const pattern of patterns) {
          lines.push(`- ${pattern.description}`)
          if (pattern.naturalLanguageExamples?.length > 0) {
            lines.push(`  Examples: "${pattern.naturalLanguageExamples.slice(0, 2).join('", "')}"`)
          }
        }
      }

      contextParts.push(lines.join("\n"))
    } else {
      // Fallback to metadata-based context
      const meta = result.metadata
      contextParts.push(`Entity: ${meta.entityName} (table: ${meta.tableName})`)
      contextParts.push(`Fields: ${meta.fieldNames.slice(0, maxFieldsPerSpec).join(", ")}${meta.fieldNames.length > maxFieldsPerSpec ? "..." : ""}`)
    }

    contextParts.push("")
    contextParts.push("---")
    contextParts.push("")
  }

  return contextParts.join("\n")
}

/**
 * Search for relevant module specs based on a natural language query.
 *
 * @param query - The natural language query
 * @param topK - Number of results to return (default: 5)
 * @param includeSpec - Whether to load and include the full spec (default: false)
 * @returns Array of matching specs with similarity scores
 */
export async function searchSpecs(
  query: string,
  topK: number = 5,
  includeSpec: boolean = false
): Promise<SpecSearchResult[]> {
  await ensureIndexExists()

  const store = getPgVector()
  const queryEmbedding = await embedText(query)

  const results = await store.query({
    indexName: INDEX_NAME,
    queryVector: queryEmbedding,
    topK,
  })

  if (!results || results.length === 0) {
    return []
  }

  const searchResults: SpecSearchResult[] = []

  for (const result of results) {
    const metadata = result.metadata as SpecEmbeddingMetadata
    const similarity = result.score ?? 0
    const matchType = classifyMatch(similarity)

    const searchResult: SpecSearchResult = {
      moduleName: metadata?.moduleName || (result.id as string).replace("spec_", ""),
      metadata: metadata,
      similarity,
      matchType,
    }

    // Optionally load the full spec
    if (includeSpec && metadata?.moduleName) {
      try {
        const spec = await loadModuleSpec(metadata.moduleName)
        if (spec) {
          searchResult.spec = spec
        }
      } catch {
        // Ignore errors loading spec
      }
    }

    searchResults.push(searchResult)
  }

  return searchResults
}

/**
 * Find the most relevant modules for a query.
 * Returns modules with at least moderate similarity.
 *
 * @param query - The natural language query
 * @param topK - Maximum number of results
 * @returns Array of relevant module names
 */
export async function findRelevantModules(
  query: string,
  topK: number = 3
): Promise<string[]> {
  const results = await searchSpecs(query, topK)

  // Filter to at least moderate matches
  const relevantResults = results.filter(
    (r) => r.matchType === "high" || r.matchType === "moderate"
  )

  console.log(
    `[spec-store] Found ${relevantResults.length} relevant modules for: "${query.slice(0, 50)}..."`
  )

  return relevantResults.map((r) => r.moduleName)
}

/**
 * Get spec search result with LLM-ready context.
 *
 * @param query - The natural language query
 * @param topK - Number of specs to include
 * @returns Combined LLM context from relevant specs
 */
export async function getSpecContextForLLM(
  query: string,
  topK: number = 3
): Promise<string> {
  const results = await searchSpecs(query, topK, true)

  if (results.length === 0) {
    return ""
  }

  const contextParts: string[] = [
    "## Relevant Module Specifications",
    "",
    "The following modules are semantically relevant to your query:",
    "",
  ]

  for (const result of results) {
    const matchLabel =
      result.matchType === "high"
        ? "HIGH RELEVANCE"
        : result.matchType === "moderate"
        ? "MODERATE RELEVANCE"
        : "LOW RELEVANCE"

    contextParts.push(`### ${result.moduleName} (${matchLabel} - ${(result.similarity * 100).toFixed(1)}%)`)

    if (result.spec) {
      // Use the rich LLM context from spec-loader
      contextParts.push(buildLLMContextFromSpec(result.spec))
    } else {
      // Fallback to metadata-based context
      const meta = result.metadata
      contextParts.push(`Entity: ${meta.entityName} (table: ${meta.tableName})`)
      contextParts.push(`Fields: ${meta.fieldNames.join(", ")}`)

      if (meta.enumFields.length > 0) {
        contextParts.push("Enum Fields:")
        for (const enumField of meta.enumFields) {
          contextParts.push(`  - ${enumField.name}: [${enumField.values.join(", ")}]`)
        }
      }

      if (meta.relationNames.length > 0) {
        contextParts.push(`Relations: ${meta.relationNames.join(", ")}`)
      }

      if (meta.linkedModules.length > 0) {
        contextParts.push(`Links to: ${meta.linkedModules.join(", ")}`)
      }
    }

    contextParts.push("")
    contextParts.push("---")
    contextParts.push("")
  }

  return contextParts.join("\n")
}

/**
 * Check if a module spec is stored.
 *
 * @param moduleName - The module name to check
 * @returns Whether the spec is stored
 */
export async function isSpecStored(moduleName: string): Promise<boolean> {
  const store = getPgVector()
  const id = `spec_${moduleName}`

  try {
    // Search for exact ID match
    const results = await store.query({
      indexName: INDEX_NAME,
      queryVector: new Array(EMBEDDING_DIM).fill(0), // Dummy vector
      topK: 100,
    })

    return results?.some((r) => r.id === id) ?? false
  } catch {
    return false
  }
}

/**
 * Delete a stored spec.
 *
 * @param moduleName - The module name to delete
 */
export async function deleteSpec(moduleName: string): Promise<void> {
  const store = getPgVector()
  const id = `spec_${moduleName}`

  try {
    await store.delete?.({
      indexName: INDEX_NAME,
      ids: [id],
    })
    console.log(`[spec-store] Deleted spec: ${moduleName}`)
  } catch (e: any) {
    console.warn(`[spec-store] Failed to delete spec:`, e?.message)
  }
}

/**
 * Get statistics about the spec store.
 */
export async function getSpecStoreStats(): Promise<{
  totalSpecs: number
  indexName: string
  dimension: number
  moduleNames: string[]
}> {
  const store = getPgVector()

  try {
    const results = await store.query({
      indexName: INDEX_NAME,
      queryVector: new Array(EMBEDDING_DIM).fill(0),
      topK: 1000,
    })

    const moduleNames = (results ?? [])
      .map((r) => (r.metadata as SpecEmbeddingMetadata)?.moduleName)
      .filter(Boolean)

    return {
      totalSpecs: results?.length || 0,
      indexName: INDEX_NAME,
      dimension: EMBEDDING_DIM,
      moduleNames,
    }
  } catch {
    return {
      totalSpecs: 0,
      indexName: INDEX_NAME,
      dimension: EMBEDDING_DIM,
      moduleNames: [],
    }
  }
}

/**
 * Clear all specs from the store.
 */
export async function clearAllSpecs(): Promise<void> {
  const store = getPgVector()

  try {
    const results = await store.query({
      indexName: INDEX_NAME,
      queryVector: new Array(EMBEDDING_DIM).fill(0),
      topK: 10000,
    })

    if (results && results.length > 0) {
      const ids = results.map((r) => r.id as string)
      await store.delete?.({
        indexName: INDEX_NAME,
        ids,
      })
      console.log(`[spec-store] Cleared ${ids.length} specs`)
    }
  } catch (e: any) {
    console.warn(`[spec-store] Failed to clear specs:`, e?.message)
  }
}

/**
 * Refresh all specs - reload from disk and re-embed.
 * Call this after regenerating specs with generate-enhanced-specs.ts.
 */
export async function refreshAllSpecs(): Promise<number> {
  console.log("[spec-store] Refreshing all specs...")
  await clearAllSpecs()
  return storeAllSpecs()
}

/**
 * DEBUG: Get the searchable text that would be generated for a module.
 * This is useful for debugging embedding quality.
 */
export async function debugGetSearchableText(moduleName: string): Promise<string | null> {
  const spec = await loadModuleSpec(moduleName)
  if (!spec) return null
  return buildSearchableText(spec)
}
