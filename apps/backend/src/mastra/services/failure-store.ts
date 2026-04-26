/**
 * Failure Store Service
 *
 * Stores and retrieves failed query execution records using PgVector for semantic search.
 * Enables failure introspection - analyzing what went wrong and suggesting fixes
 * based on historical data and resolution patterns.
 *
 * Phase 3 Enhancement: Track failures and their resolutions for improved retry strategies.
 */

// @ts-nocheck
import { PgVector } from "@mastra/pg"
import {
  embedText,
  classifyMatch,
  EMBEDDING_CONFIG,
} from "./embedding-service"
import { planStoreLogger as log } from "./logger"

// ─── Configuration ───────────────────────────────────────────────────────────

const INDEX_NAME = process.env.AI_FAILURE_STORE_INDEX || "ai_query_failures"
const EMBEDDING_DIM = EMBEDDING_CONFIG.dimension

// Failure retention period in days (default: 30 days)
const FAILURE_RETENTION_DAYS = parseInt(process.env.AI_V3_FAILURE_RETENTION_DAYS || "30", 10)

// ─── Types ───────────────────────────────────────────────────────────────────

export type FailureErrorCode =
  | "NO_RESULTS"
  | "API_ERROR"
  | "EXTRACTION_FAILED"
  | "PLAN_GENERATION_FAILED"
  | "ENTITY_NOT_FOUND"
  | "PERMISSION_DENIED"
  | "TIMEOUT"
  | "VALIDATION_ERROR"
  | "UNKNOWN"

export interface QueryPlanStep {
  action: string
  entity: string
  method?: string
  filters?: Record<string, any>
  relations?: string[]
}

export interface QueryPlan {
  steps: QueryPlanStep[]
  entities: string[]
  intent: string
}

export interface FailedQueryRecord {
  id: string
  query: string
  plan: QueryPlan | null
  failureStep: number  // Which step in the plan failed (0-indexed, -1 if no plan)
  errorCode: FailureErrorCode
  errorMessage: string
  context?: {
    mode?: string
    detectedEntities?: string[]
    specMatchTypes?: any[]
  }
  suggestedFix?: string
  resolvedBy?: string  // ID of successful query that fixed this pattern
  createdAt: Date
}

export interface FailureSearchResult {
  failure: FailedQueryRecord
  similarity: number
  matchType: "high" | "moderate" | "low"
}

export interface ResolutionPattern {
  failureId: string
  successfulQuery: string
  successfulPlan: QueryPlan
  wasSuccessful: boolean
  description: string
}

// ─── Vector Store ───────────────────────────────────────────────────────────

let vectorStore: PgVector | null = null

async function getVectorStore(): Promise<PgVector> {
  if (vectorStore) return vectorStore

  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error("POSTGRES_URL or DATABASE_URL must be set for failure store")
  }

  vectorStore = new PgVector(connectionString)

  // Initialize the index if it doesn't exist
  try {
    await vectorStore.createIndex({
      indexName: INDEX_NAME,
      dimension: EMBEDDING_DIM,
    })
    log.info("Failure store index created or already exists", { indexName: INDEX_NAME })
  } catch (error: any) {
    // Index might already exist, which is fine
    if (!error.message?.includes("already exists")) {
      log.warn("Error creating failure store index", { error: error.message })
    }
  }

  return vectorStore
}

// ─── Store Functions ────────────────────────────────────────────────────────

/**
 * Store a failed query execution for future analysis
 */
export async function storeFailure(
  query: string,
  plan: QueryPlan | null,
  errorCode: FailureErrorCode,
  errorMessage: string,
  failureStep: number = -1,
  context?: FailedQueryRecord["context"]
): Promise<string> {
  log.operationStart("Store Failure", { query: query.slice(0, 50), errorCode })

  try {
    const store = await getVectorStore()
    const id = `failure_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    // Create searchable text from query, error, and context
    const searchableText = [
      query,
      `Error: ${errorCode}`,
      errorMessage,
      plan?.entities?.join(" ") || "",
      context?.detectedEntities?.join(" ") || "",
    ].filter(Boolean).join(" ")

    // Generate embedding for semantic search
    const embedding = await embedText(searchableText)

    const failureRecord: FailedQueryRecord = {
      id,
      query,
      plan,
      failureStep,
      errorCode,
      errorMessage,
      context,
      createdAt: new Date(),
    }

    // Store in vector database
    await store.upsert({
      indexName: INDEX_NAME,
      vectors: [embedding],
      metadata: [
        {
          ...failureRecord,
          createdAt: failureRecord.createdAt.toISOString(),
          plan: plan ? JSON.stringify(plan) : null,
          context: context ? JSON.stringify(context) : null,
        },
      ],
      ids: [id],
    })

    log.info("Failure stored successfully", { id, errorCode, query: query.slice(0, 50) })
    return id
  } catch (error) {
    log.error("Failed to store failure record", { error: String(error) })
    throw error
  }
}

/**
 * Search for similar past failures
 */
export async function searchSimilarFailures(
  query: string,
  errorCode?: FailureErrorCode,
  topK: number = 5
): Promise<FailureSearchResult[]> {
  log.operationStart("Search Similar Failures", { query: query.slice(0, 50), errorCode })

  try {
    const store = await getVectorStore()

    // Build search text
    const searchText = errorCode ? `${query} Error: ${errorCode}` : query
    const queryEmbedding = await embedText(searchText)

    // Query vector store
    const results = await store.query({
      indexName: INDEX_NAME,
      queryVector: queryEmbedding,
      topK: topK * 2, // Get more results to filter
      includeMetadata: true,
    })

    if (!results || results.length === 0) {
      log.info("No similar failures found")
      return []
    }

    // Process and filter results
    const failures: FailureSearchResult[] = []

    for (const result of results) {
      const metadata = result.metadata as any

      // Filter by error code if specified
      if (errorCode && metadata.errorCode !== errorCode) {
        continue
      }

      const similarity = result.score || 0
      const matchType = classifyMatch(similarity)

      // Skip low similarity matches
      if (matchType === "low") continue

      const failure: FailedQueryRecord = {
        id: metadata.id,
        query: metadata.query,
        plan: metadata.plan ? JSON.parse(metadata.plan) : null,
        failureStep: metadata.failureStep || -1,
        errorCode: metadata.errorCode,
        errorMessage: metadata.errorMessage,
        context: metadata.context ? JSON.parse(metadata.context) : undefined,
        suggestedFix: metadata.suggestedFix,
        resolvedBy: metadata.resolvedBy,
        createdAt: new Date(metadata.createdAt),
      }

      failures.push({
        failure,
        similarity,
        matchType,
      })

      if (failures.length >= topK) break
    }

    log.info("Similar failures found", { count: failures.length })
    return failures
  } catch (error) {
    log.error("Failed to search similar failures", { error: String(error) })
    return []
  }
}

/**
 * Find resolution patterns for a failure
 * Searches for successful queries that are similar to the failed query
 */
export async function findResolutionPattern(
  failureId: string
): Promise<ResolutionPattern | null> {
  log.operationStart("Find Resolution Pattern", { failureId })

  try {
    const store = await getVectorStore()

    // First, get the failure record
    const results = await store.query({
      indexName: INDEX_NAME,
      queryVector: await embedText(failureId), // This won't match well, we need the actual failure
      topK: 100,
      includeMetadata: true,
    })

    // Find the failure by ID
    const failureResult = results?.find((r: any) => r.metadata?.id === failureId)
    if (!failureResult) {
      log.info("Failure record not found", { failureId })
      return null
    }

    const failure = failureResult.metadata as any

    // If this failure was already resolved, return that resolution
    if (failure.resolvedBy) {
      log.info("Failure already has resolution", { failureId, resolvedBy: failure.resolvedBy })

      // Try to find the successful plan from plan store
      // (Would need to import from plan-store, but keeping it simple for now)
      return {
        failureId,
        successfulQuery: `Resolution for: ${failure.query}`,
        successfulPlan: failure.plan ? JSON.parse(failure.plan) : { steps: [], entities: [], intent: "data" },
        wasSuccessful: true,
        description: `Previously resolved by query ID: ${failure.resolvedBy}`,
      }
    }

    // No resolution found yet
    log.info("No resolution pattern found", { failureId })
    return null
  } catch (error) {
    log.error("Failed to find resolution pattern", { error: String(error) })
    return null
  }
}

/**
 * Mark a failure as resolved by a successful query
 */
export async function markFailureResolved(
  failureId: string,
  resolvedByQueryId: string,
  suggestedFix?: string
): Promise<void> {
  log.operationStart("Mark Failure Resolved", { failureId, resolvedByQueryId })

  try {
    const store = await getVectorStore()

    // Get existing failure record
    const results = await store.query({
      indexName: INDEX_NAME,
      queryVector: await embedText(failureId),
      topK: 100,
      includeMetadata: true,
    })

    const failureResult = results?.find((r: any) => r.metadata?.id === failureId)
    if (!failureResult) {
      log.warn("Failure record not found for resolution marking", { failureId })
      return
    }

    const metadata = failureResult.metadata as any

    // Update with resolution info
    await store.upsert({
      indexName: INDEX_NAME,
      vectors: [failureResult.vector || await embedText(metadata.query)],
      metadata: [
        {
          ...metadata,
          resolvedBy: resolvedByQueryId,
          suggestedFix: suggestedFix || metadata.suggestedFix,
        },
      ],
      ids: [failureId],
    })

    log.info("Failure marked as resolved", { failureId, resolvedByQueryId })
  } catch (error) {
    log.error("Failed to mark failure as resolved", { error: String(error) })
  }
}

/**
 * Clean up old failure records
 */
export async function cleanupOldFailures(): Promise<number> {
  log.operationStart("Cleanup Old Failures", { retentionDays: FAILURE_RETENTION_DAYS })

  try {
    const store = await getVectorStore()
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - FAILURE_RETENTION_DAYS)

    // Query all records (expensive, but necessary for cleanup)
    const results = await store.query({
      indexName: INDEX_NAME,
      queryVector: new Array(EMBEDDING_DIM).fill(0), // Dummy vector
      topK: 10000,
      includeMetadata: true,
    })

    if (!results || results.length === 0) {
      log.info("No failures to clean up")
      return 0
    }

    // Find old records to delete
    const idsToDelete: string[] = []
    for (const result of results) {
      const metadata = result.metadata as any
      const createdAt = new Date(metadata.createdAt)

      if (createdAt < cutoffDate && !metadata.resolvedBy) {
        // Only delete unresolved old failures
        idsToDelete.push(metadata.id)
      }
    }

    if (idsToDelete.length === 0) {
      log.info("No old failures to delete")
      return 0
    }

    // Delete old records
    await store.deleteIndexByIds({
      indexName: INDEX_NAME,
      ids: idsToDelete,
    })

    log.info("Old failures cleaned up", { deletedCount: idsToDelete.length })
    return idsToDelete.length
  } catch (error) {
    log.error("Failed to cleanup old failures", { error: String(error) })
    return 0
  }
}

/**
 * Get failure statistics
 */
export async function getFailureStats(): Promise<{
  totalFailures: number
  byErrorCode: Record<FailureErrorCode, number>
  resolvedCount: number
  unresolvedCount: number
}> {
  log.operationStart("Get Failure Stats")

  try {
    const store = await getVectorStore()

    const results = await store.query({
      indexName: INDEX_NAME,
      queryVector: new Array(EMBEDDING_DIM).fill(0),
      topK: 10000,
      includeMetadata: true,
    })

    const stats = {
      totalFailures: results?.length || 0,
      byErrorCode: {} as Record<FailureErrorCode, number>,
      resolvedCount: 0,
      unresolvedCount: 0,
    }

    for (const result of results || []) {
      const metadata = result.metadata as any
      const errorCode = metadata.errorCode as FailureErrorCode

      stats.byErrorCode[errorCode] = (stats.byErrorCode[errorCode] || 0) + 1

      if (metadata.resolvedBy) {
        stats.resolvedCount++
      } else {
        stats.unresolvedCount++
      }
    }

    log.info("Failure stats retrieved", stats)
    return stats
  } catch (error) {
    log.error("Failed to get failure stats", { error: String(error) })
    return {
      totalFailures: 0,
      byErrorCode: {} as Record<FailureErrorCode, number>,
      resolvedCount: 0,
      unresolvedCount: 0,
    }
  }
}

/**
 * Analyze a failure and suggest a fix based on patterns
 */
export async function analyzeFailureAndSuggestFix(
  query: string,
  errorCode: FailureErrorCode,
  errorMessage: string,
  plan?: QueryPlan
): Promise<{
  suggestion: string | null
  similarFailures: FailureSearchResult[]
  resolutionFound: boolean
}> {
  log.operationStart("Analyze Failure", { query: query.slice(0, 50), errorCode })

  try {
    // Search for similar failures
    const similarFailures = await searchSimilarFailures(query, errorCode, 5)

    // Check if any have resolutions
    let suggestion: string | null = null
    let resolutionFound = false

    for (const { failure } of similarFailures) {
      if (failure.resolvedBy || failure.suggestedFix) {
        resolutionFound = true
        suggestion = failure.suggestedFix || `A similar query was resolved. Try a different approach.`
        break
      }
    }

    // Generate suggestions based on error code if no resolution found
    if (!suggestion) {
      suggestion = generateSuggestionForErrorCode(errorCode, errorMessage, plan)
    }

    log.info("Failure analysis complete", {
      similarCount: similarFailures.length,
      resolutionFound,
      hasSuggestion: !!suggestion,
    })

    return {
      suggestion,
      similarFailures,
      resolutionFound,
    }
  } catch (error) {
    log.error("Failed to analyze failure", { error: String(error) })
    return {
      suggestion: null,
      similarFailures: [],
      resolutionFound: false,
    }
  }
}

/**
 * Generate a suggestion based on the error code
 */
function generateSuggestionForErrorCode(
  errorCode: FailureErrorCode,
  errorMessage: string,
  plan?: QueryPlan
): string {
  switch (errorCode) {
    case "NO_RESULTS":
      return "The query returned no data. Try broadening your search criteria or checking if the entity exists."

    case "ENTITY_NOT_FOUND":
      const entities = plan?.entities?.join(", ") || "unknown"
      return `Entity not recognized: ${entities}. Verify the entity name matches available modules.`

    case "API_ERROR":
      return "API request failed. Check endpoint availability and request parameters."

    case "EXTRACTION_FAILED":
      return "Failed to extract information from the response. The data format may have changed."

    case "PLAN_GENERATION_FAILED":
      return "Could not generate a query plan. Try rephrasing the question with more specific terms."

    case "PERMISSION_DENIED":
      return "Access denied. Check authentication and authorization settings."

    case "TIMEOUT":
      return "Request timed out. Try a more specific query or reduce the data scope."

    case "VALIDATION_ERROR":
      return `Validation failed: ${errorMessage}. Check the input parameters.`

    default:
      return "An unexpected error occurred. Please try rephrasing your question."
  }
}
