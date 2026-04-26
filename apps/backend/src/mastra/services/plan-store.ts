/**
 * Plan Store Service
 *
 * Stores and retrieves query plans using PgVector for semantic search.
 * Enables the "learning RAG" pattern where successful query plans are stored
 * and can be reused for similar future queries.
 *
 * Uses the same PgVector pattern as adminCatalog.ts and memory.ts.
 */

// @ts-nocheck
import { PgVector } from "@mastra/pg"
import {
  embedText,
  embedTexts,
  classifyMatch,
  EMBEDDING_CONFIG,
} from "./embedding-service"
import { planStoreLogger as log } from "./logger"

// ─── Configuration ───────────────────────────────────────────────────────────

const INDEX_NAME = process.env.AI_PLAN_STORE_INDEX || "ai_query_plans"
const EMBEDDING_DIM = EMBEDDING_CONFIG.dimension

// ─── Types ───────────────────────────────────────────────────────────────────

export interface QueryPlan {
  steps: QueryPlanStep[]
  entities: string[]
  intent: string
  // Phase 2: Additional metadata for learning mode
  queryMode?: string   // The mode that generated this plan (data, analysis, chat, understand)
  learnedAt?: string   // ISO timestamp when the plan was learned
}

export interface QueryPlanStep {
  action: string
  entity: string
  method?: string
  filters?: Record<string, any>
  relations?: string[]
}

export interface StoredPlan {
  id: string
  query: string
  intent: string
  entities: string[]
  plan: QueryPlan
  successCount: number
  lastUsed: Date
  createdAt: Date
}

export interface PlanSearchResult {
  plan: StoredPlan
  similarity: number
  matchType: "high" | "moderate" | "low"
  canReuse: boolean
  needsAdaptation: boolean
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
      "Missing POSTGRES_CONNECTION_STRING or DATABASE_URL for plan store"
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
        // Try object signature first
        await store.createIndex?.({
          indexName: INDEX_NAME,
          dimension: EMBEDDING_DIM,
          metric: "cosine",
        })
        log.info("Created index", { indexName: INDEX_NAME })
      } catch {
        // Fallback to positional signature
        await store.createIndex?.(INDEX_NAME, EMBEDDING_DIM, "cosine")
        log.info("Created index (fallback)", { indexName: INDEX_NAME })
      }
    }
  } catch (e: any) {
    log.warn("Index setup warning", { error: e?.message })
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialize the plan store.
 * Call this at startup to ensure the index exists.
 */
export async function initPlanStore(): Promise<void> {
  await ensureIndexExists()
}

/**
 * Store a successful query plan for future reuse.
 *
 * @param query - The natural language query
 * @param plan - The executed query plan
 * @returns The ID of the stored plan
 */
export async function storePlan(
  query: string,
  plan: QueryPlan
): Promise<string> {
  await ensureIndexExists()

  const store = getPgVector()
  const id = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  // Generate embedding for the query
  const embedding = await embedText(query)

  const metadata = {
    query,
    intent: plan.intent,
    entities: plan.entities,
    plan: JSON.stringify(plan),
    successCount: 1,
    lastUsed: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  }

  await store.upsert({
    indexName: INDEX_NAME,
    vectors: [embedding],
    ids: [id],
    metadata: [metadata],
  })

  log.info("Stored plan", { id, query: query.slice(0, 50) + "..." })
  return id
}

/**
 * Search for similar plans to a given query.
 *
 * @param query - The natural language query to search for
 * @param topK - Number of results to return (default: 3)
 * @returns Array of matching plans with similarity scores
 */
export async function searchPlans(
  query: string,
  topK: number = 3
): Promise<PlanSearchResult[]> {
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

  return results.map((result) => {
    const metadata = result.metadata as any
    const similarity = result.score ?? 0
    const matchType = classifyMatch(similarity)

    const storedPlan: StoredPlan = {
      id: result.id as string,
      query: metadata?.query || "",
      intent: metadata?.intent || "unknown",
      entities: metadata?.entities || [],
      plan: metadata?.plan ? JSON.parse(metadata.plan) : { steps: [], entities: [], intent: "unknown" },
      successCount: metadata?.successCount || 0,
      lastUsed: metadata?.lastUsed ? new Date(metadata.lastUsed) : new Date(),
      createdAt: metadata?.createdAt ? new Date(metadata.createdAt) : new Date(),
    }

    return {
      plan: storedPlan,
      similarity,
      matchType,
      canReuse: matchType === "high",
      needsAdaptation: matchType === "moderate",
    }
  })
}

/**
 * Find the best matching plan for a query.
 *
 * @param query - The natural language query
 * @returns The best matching plan, or null if no good match
 */
export async function findBestPlan(
  query: string
): Promise<PlanSearchResult | null> {
  const results = await searchPlans(query, 1)

  if (results.length === 0) {
    return null
  }

  const best = results[0]

  // Only return if at least moderate match
  if (best.matchType === "low") {
    log.debug("No good match for query", {
      query: query.slice(0, 50) + "...",
      bestSimilarity: `${(best.similarity * 100).toFixed(1)}%`,
    })
    return null
  }

  log.info("Found matching plan", {
    matchType: best.matchType,
    originalQuery: best.plan.query.slice(0, 50) + "...",
    similarity: `${(best.similarity * 100).toFixed(1)}%`,
  })
  return best
}

/**
 * Update success count for a plan after successful execution.
 *
 * @param planId - The ID of the plan to update
 */
export async function incrementSuccessCount(planId: string): Promise<void> {
  const store = getPgVector()

  try {
    // Fetch current plan
    const results = await store.query({
      indexName: INDEX_NAME,
      queryVector: new Array(EMBEDDING_DIM).fill(0), // Dummy vector
      topK: 100, // Get all to find by ID
    })

    const plan = results?.find((r) => r.id === planId)
    if (!plan) {
      log.warn("Plan not found for success increment", { planId })
      return
    }

    const metadata = plan.metadata as any
    const updatedMetadata = {
      ...metadata,
      successCount: (metadata?.successCount || 0) + 1,
      lastUsed: new Date().toISOString(),
    }

    // Re-store with updated metadata
    // Note: This is a workaround since PgVector doesn't have direct update
    // In production, consider using raw SQL for efficiency
    await store.upsert({
      indexName: INDEX_NAME,
      vectors: [plan.vector as number[]],
      ids: [planId],
      metadata: [updatedMetadata],
    })

    log.info("Updated success count", { planId })
  } catch (e: any) {
    log.warn("Failed to update success count", { error: e?.message })
  }
}

/**
 * Delete a plan from the store.
 *
 * @param planId - The ID of the plan to delete
 */
export async function deletePlan(planId: string): Promise<void> {
  const store = getPgVector()

  try {
    await store.delete?.({
      indexName: INDEX_NAME,
      ids: [planId],
    })
    log.info("Deleted plan", { planId })
  } catch (e: any) {
    log.warn("Failed to delete plan", { error: e?.message })
  }
}

/**
 * Store multiple plans at once (batch operation).
 *
 * @param plans - Array of query/plan pairs to store
 * @returns Array of stored plan IDs
 */
export async function storePlans(
  plans: Array<{ query: string; plan: QueryPlan }>
): Promise<string[]> {
  await ensureIndexExists()

  if (plans.length === 0) {
    return []
  }

  const store = getPgVector()
  const queries = plans.map((p) => p.query)
  const embeddings = await embedTexts(queries)

  const ids: string[] = []
  const metadataList: any[] = []

  for (let i = 0; i < plans.length; i++) {
    const id = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${i}`
    ids.push(id)

    metadataList.push({
      query: plans[i].query,
      intent: plans[i].plan.intent,
      entities: plans[i].plan.entities,
      plan: JSON.stringify(plans[i].plan),
      successCount: 1,
      lastUsed: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    })
  }

  await store.upsert({
    indexName: INDEX_NAME,
    vectors: embeddings,
    ids,
    metadata: metadataList,
  })

  log.info("Stored multiple plans", { count: plans.length })
  return ids
}

/**
 * Get statistics about the plan store.
 */
export async function getPlanStats(): Promise<{
  totalPlans: number
  indexName: string
  dimension: number
}> {
  const store = getPgVector()

  try {
    // Query with dummy vector to get count
    const results = await store.query({
      indexName: INDEX_NAME,
      queryVector: new Array(EMBEDDING_DIM).fill(0),
      topK: 1000,
    })

    return {
      totalPlans: results?.length || 0,
      indexName: INDEX_NAME,
      dimension: EMBEDDING_DIM,
    }
  } catch {
    return {
      totalPlans: 0,
      indexName: INDEX_NAME,
      dimension: EMBEDDING_DIM,
    }
  }
}

/**
 * Clear all plans from the store (use with caution).
 */
export async function clearAllPlans(): Promise<void> {
  const store = getPgVector()

  try {
    // Get all plan IDs
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
      log.info("Cleared all plans", { count: ids.length })
    }
  } catch (e: any) {
    log.warn("Failed to clear plans", { error: e?.message })
  }
}

// ─── Example Formatting for Dynamic Prompts ─────────────────────────────────

export interface FormattedPlanExample {
  query: string
  plan: QueryPlan
  similarity: number
  successCount: number
}

/**
 * Format a stored plan as an example for the LLM prompt.
 */
function formatPlanAsExample(result: PlanSearchResult): string {
  const { plan: storedPlan, similarity } = result
  const successNote = storedPlan.successCount > 1
    ? ` (executed successfully ${storedPlan.successCount} times)`
    : ""

  const lines: string[] = [
    `### Example: "${storedPlan.query}"${successNote}`,
    "```json",
    JSON.stringify({
      steps: storedPlan.plan.steps,
      finalEntity: storedPlan.plan.steps[storedPlan.plan.steps.length - 1]?.entity || "unknown",
      explanation: `Pattern from successful query (${(similarity * 100).toFixed(0)}% similar)`,
    }, null, 2),
    "```",
  ]

  return lines.join("\n")
}

/**
 * Get similar examples from stored plans for dynamic prompt building.
 * Returns formatted examples ready to be inserted into the query planner prompt.
 *
 * @param query - The user's query to find similar examples for
 * @param topK - Number of examples to retrieve (default: 3)
 * @param minSimilarity - Minimum similarity threshold (default: 0.5)
 * @returns Array of formatted examples with metadata
 */
export async function getSimilarExamples(
  query: string,
  topK: number = 3,
  minSimilarity: number = 0.5
): Promise<{ examples: FormattedPlanExample[]; formattedText: string }> {
  try {
    const results = await searchPlans(query, topK)

    // Filter by minimum similarity
    const validResults = results.filter((r) => r.similarity >= minSimilarity)

    if (validResults.length === 0) {
      log.debug("No similar examples found", { query: query.slice(0, 50) + "..." })
      return { examples: [], formattedText: "" }
    }

    // Format examples
    const examples: FormattedPlanExample[] = validResults.map((r) => ({
      query: r.plan.query,
      plan: r.plan.plan,
      similarity: r.similarity,
      successCount: r.plan.successCount,
    }))

    // Build formatted text for prompt insertion
    const formattedExamples = validResults.map(formatPlanAsExample)
    const formattedText = [
      "## Similar Successful Queries (Learn from these patterns)",
      "",
      ...formattedExamples,
    ].join("\n")

    log.info("Found similar examples for prompt", { count: examples.length })

    return { examples, formattedText }
  } catch (error: any) {
    log.warn("Error getting similar examples", { error: error?.message })
    return { examples: [], formattedText: "" }
  }
}

/**
 * Store a spec document for semantic search.
 * Useful for indexing module specs so LLM can find relevant documentation.
 *
 * @param specName - Name of the spec (e.g., "designs", "partners")
 * @param content - The spec content (JSON stringified or markdown)
 * @param metadata - Additional metadata about the spec
 */
export async function storeSpecDocument(
  specName: string,
  content: string,
  metadata: Record<string, any> = {}
): Promise<string> {
  await ensureIndexExists()

  const store = getPgVector()
  const id = `spec_${specName}_${Date.now()}`

  // Generate embedding for the spec content
  const embedding = await embedText(content.slice(0, 8000)) // Limit for embedding

  const docMetadata = {
    type: "spec",
    specName,
    content: content.slice(0, 50000), // Store truncated for retrieval
    ...metadata,
    createdAt: new Date().toISOString(),
  }

  await store.upsert({
    indexName: INDEX_NAME,
    vectors: [embedding],
    ids: [id],
    metadata: [docMetadata],
  })

  log.info("Stored spec document", { id, specName })
  return id
}

/**
 * Search for relevant spec documents.
 *
 * @param query - Search query
 * @param topK - Number of results
 * @returns Matching spec documents
 */
export async function searchSpecDocuments(
  query: string,
  topK: number = 3
): Promise<Array<{ specName: string; content: string; similarity: number }>> {
  await ensureIndexExists()

  const store = getPgVector()
  const queryEmbedding = await embedText(query)

  const results = await store.query({
    indexName: INDEX_NAME,
    queryVector: queryEmbedding,
    topK: topK * 2, // Get more to filter
  })

  if (!results || results.length === 0) {
    return []
  }

  // Filter to only spec documents
  return results
    .filter((r) => (r.metadata as any)?.type === "spec")
    .slice(0, topK)
    .map((r) => ({
      specName: (r.metadata as any)?.specName || "unknown",
      content: (r.metadata as any)?.content || "",
      similarity: r.score ?? 0,
    }))
}
