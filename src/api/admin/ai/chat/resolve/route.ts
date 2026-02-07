/**
 * @file AI Chat Query Resolution Endpoint
 * @module api/admin/ai/chat/resolve
 *
 * Resolves natural language queries into executable Medusa 2.x code using
 * hybrid BM25 search + LLM analysis.
 *
 * @example
 * POST /admin/ai/chat/resolve
 * {
 *   "query": "show me all designs with their specifications"
 * }
 *
 * @returns {Object} Resolution result with execution plan
 * {
 *   "resolved": {
 *     "query": "show me all designs with their specifications",
 *     "targetEntity": "design",
 *     "mode": "data",
 *     "patterns": [...],
 *     "executionPlan": [...],
 *     "confidence": 0.95,
 *     "source": "indexed" | "bm25_llm" | "fallback"
 *   }
 * }
 */

import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HybridQueryResolverService } from "../../../../../mastra/services/hybrid-query-resolver"

// Singleton instance
let resolverInstance: HybridQueryResolverService | null = null

function getResolver(): HybridQueryResolverService {
  if (!resolverInstance) {
    resolverInstance = new HybridQueryResolverService({
      llmApiKey: process.env.OPENROUTER_API_KEY,
      projectRoot: process.cwd(),
      useIndexedFirst: true,
      maxSearchResults: 5,
    })
  }
  return resolverInstance
}

/**
 * POST /admin/ai/chat/resolve
 * Resolve a natural language query into an execution plan
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const body = (req as any).validatedBody || req.body
    const { query, options } = body as {
      query: string
      options?: {
        useIndexedFirst?: boolean
        skipLLM?: boolean
      }
    }

    if (!query || typeof query !== "string") {
      return res.status(400).json({
        error: "Missing required field: query",
      })
    }

    const resolver = getResolver()

    // Check indexed docs status
    const indexedStatus = resolver.hasIndexedDocs()

    // Resolve the query
    const startTime = Date.now()
    const resolved = await resolver.resolve(query)
    const duration = Date.now() - startTime

    res.json({
      resolved,
      meta: {
        duration_ms: duration,
        indexed_docs: indexedStatus,
      },
    })
  } catch (error: any) {
    console.error("[AI Chat Resolve] Error:", error)
    res.status(500).json({
      error: error.message || "Failed to resolve query",
    })
  }
}

/**
 * GET /admin/ai/chat/resolve
 * Get resolver status and search without LLM
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const query = req.query.q as string | undefined

    const resolver = getResolver()
    const indexedStatus = resolver.hasIndexedDocs()

    if (query) {
      // Search only (no LLM)
      const searchResults = resolver.search(query)
      return res.json({
        query,
        search_results: searchResults.map(r => ({
          file: r.file,
          score: r.score,
          matched_terms: [...new Set(r.hits.map(h => h.term))],
        })),
        indexed_docs: indexedStatus,
      })
    }

    // Status only
    res.json({
      status: "ok",
      indexed_docs: indexedStatus,
      config: {
        llm_configured: !!process.env.OPENROUTER_API_KEY,
        project_root: process.cwd(),
      },
    })
  } catch (error: any) {
    console.error("[AI Chat Resolve] Error:", error)
    res.status(500).json({
      error: error.message || "Failed to get resolver status",
    })
  }
}
