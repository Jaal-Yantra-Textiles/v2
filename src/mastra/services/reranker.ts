/**
 * Reranker Service
 *
 * Based on Anthropic's Contextual Retrieval research.
 * Reranks initial search results using a fast LLM to filter
 * and prioritize the most relevant chunks.
 *
 * Performance: Adds ~18% improvement to retrieval accuracy on top of
 * contextual embeddings.
 *
 * Usage:
 *   const reranked = await rerankChunks(query, searchResults, { topK: 20 })
 */

import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { generateText } from "ai"

// ============================================================================
// Types
// ============================================================================

export interface SearchResult {
  file: string
  score: number
  snippet: string
  context?: string // Contextual summary if available
}

export interface RerankResult extends SearchResult {
  rerankScore: number
  finalScore: number
  reasoning?: string
}

export interface RerankOptions {
  topK?: number // Number of results to return (default: 20)
  candidateLimit?: number // Max candidates to consider (default: 100)
  minScore?: number // Minimum relevance score 0-10 (default: 4)
  includeReasoning?: boolean // Include LLM reasoning (default: false)
}

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  // Fast, free model via OpenRouter for reranking
  model: "google/gemini-2.0-flash-exp:free",
  fallbackModels: [
    "mistralai/devstral-2512:free",
    "meta-llama/llama-3.3-70b-instruct:free",
  ],
  maxTokens: 2000,
  // Weighting for final score: original * (1-weight) + rerank * weight
  rerankWeight: 0.7,
}

// ============================================================================
// Reranker Implementation
// ============================================================================

/**
 * Build the reranking prompt
 */
function buildRerankPrompt(
  query: string,
  candidates: SearchResult[],
  includeReasoning: boolean
): string {
  const chunksText = candidates
    .map((c, i) => {
      const contextPrefix = c.context ? `[Context: ${c.context}]\n` : ""
      const snippetPreview = c.snippet.slice(0, 600)
      return `[${i}] File: ${c.file}\n${contextPrefix}${snippetPreview}${c.snippet.length > 600 ? "..." : ""}`
    })
    .join("\n\n---\n\n")

  const responseFormat = includeReasoning
    ? `[{"index": 0, "score": 8, "reason": "brief reason"}, ...]`
    : `[{"index": 0, "score": 8}, ...]`

  return `You are a code relevance evaluator for a Medusa 2.x e-commerce codebase.

USER QUERY: "${query}"

CANDIDATE CODE CHUNKS:
${chunksText}

TASK: Score each chunk's relevance to the user's query on a scale of 0-10:
- 10: Exactly what the user is looking for (e.g., direct answer, exact entity/endpoint)
- 7-9: Highly relevant (e.g., related entity, similar operation)
- 4-6: Somewhat relevant (e.g., related module, tangentially useful)
- 1-3: Marginally relevant (e.g., mentions keyword but wrong context)
- 0: Not relevant

SCORING GUIDELINES:
- Entity match: If query mentions "designs" and chunk is about Design entity → high score
- Operation match: If query is "list orders" and chunk shows GET /admin/orders → high score
- Relation match: If query asks about "design with customer" and chunk shows design-customer link → high score
- Wrong entity: If query is about "orders" but chunk is about "products" → low score
- Test files or mocks: Always score 0-2

RESPONSE FORMAT:
Return a JSON array of scores. Only include chunks with score >= 4.
${responseFormat}

Important:
- Be selective - only high-quality matches should pass
- Consider the CONTEXT if provided - it summarizes what the code does
- Prefer files that directly implement what the user is asking about`
}

/**
 * Parse the LLM response into scores
 */
function parseRerankResponse(
  response: string,
  includeReasoning: boolean
): Array<{ index: number; score: number; reason?: string }> {
  try {
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = response.trim()
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/```json?\n?/g, "").replace(/```$/g, "").trim()
    }

    const parsed = JSON.parse(jsonStr)

    if (!Array.isArray(parsed)) {
      console.warn("[Reranker] Response is not an array")
      return []
    }

    return parsed
      .filter((item: any) => typeof item.index === "number" && typeof item.score === "number")
      .map((item: any) => ({
        index: item.index,
        score: Math.min(10, Math.max(0, item.score)), // Clamp to 0-10
        reason: includeReasoning ? item.reason : undefined,
      }))
  } catch (error) {
    console.error("[Reranker] Failed to parse response:", error)
    return []
  }
}

/**
 * Rerank search results using LLM
 *
 * Takes initial search results and uses a fast LLM to score relevance,
 * returning the top K most relevant results.
 *
 * @param query - The user's natural language query
 * @param candidates - Initial search results to rerank
 * @param options - Reranking options
 * @returns Reranked results with scores
 */
export async function rerankChunks(
  query: string,
  candidates: SearchResult[],
  options: RerankOptions = {}
): Promise<RerankResult[]> {
  const {
    topK = 20,
    candidateLimit = 100,
    minScore = 4,
    includeReasoning = false,
  } = options

  // Limit candidates to process
  const toProcess = candidates.slice(0, candidateLimit)

  if (toProcess.length === 0) {
    return []
  }

  // Check for API key
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.warn("[Reranker] No OPENROUTER_API_KEY, returning original order")
    return toProcess.slice(0, topK).map((c, i) => ({
      ...c,
      rerankScore: 5,
      finalScore: c.score,
    }))
  }

  console.log(`[Reranker] Processing ${toProcess.length} candidates for query: "${query.slice(0, 50)}..."`)

  try {
    const openrouter = createOpenRouter({ apiKey })
    const prompt = buildRerankPrompt(query, toProcess, includeReasoning)

    // Try primary model, fall back to alternatives if rate limited
    const models = [CONFIG.model, ...CONFIG.fallbackModels]
    let responseText = ""
    let lastError: Error | null = null

    for (const modelId of models) {
      try {
        const { text } = await generateText({
          model: openrouter(modelId) as any,
          prompt,
          maxOutputTokens: CONFIG.maxTokens,
          temperature: 0.1,
        })
        responseText = text
        console.log(`[Reranker] Successfully used model: ${modelId}`)
        break
      } catch (error: any) {
        lastError = error
        const isRateLimit = error?.statusCode === 429 || error?.message?.includes("429")
        console.warn(`[Reranker] Model ${modelId} failed${isRateLimit ? " (rate limited)" : ""}: ${error?.message}`)
        // Continue to next model
      }
    }

    if (!responseText && lastError) {
      throw lastError
    }

    const scores = parseRerankResponse(responseText, includeReasoning)

    if (scores.length === 0) {
      console.warn("[Reranker] No valid scores returned, using original order")
      return toProcess.slice(0, topK).map((c) => ({
        ...c,
        rerankScore: 5,
        finalScore: c.score,
      }))
    }

    // Map scores to results
    const reranked: RerankResult[] = []

    for (const scoreInfo of scores) {
      if (scoreInfo.index >= 0 && scoreInfo.index < toProcess.length) {
        const candidate = toProcess[scoreInfo.index]

        if (scoreInfo.score >= minScore) {
          // Normalize original score to 0-10 scale (assume max original score is 20)
          const normalizedOriginal = Math.min(10, (candidate.score / 20) * 10)

          // Calculate final score with weighting
          const finalScore =
            normalizedOriginal * (1 - CONFIG.rerankWeight) +
            scoreInfo.score * CONFIG.rerankWeight

          reranked.push({
            ...candidate,
            rerankScore: scoreInfo.score,
            finalScore,
            reasoning: scoreInfo.reason,
          })
        }
      }
    }

    // Sort by final score
    reranked.sort((a, b) => b.finalScore - a.finalScore)

    console.log(`[Reranker] Returned ${Math.min(reranked.length, topK)} of ${scores.length} scored candidates`)

    return reranked.slice(0, topK)
  } catch (error) {
    console.error("[Reranker] Error:", error)
    // Fallback to original order
    return toProcess.slice(0, topK).map((c) => ({
      ...c,
      rerankScore: 5,
      finalScore: c.score,
    }))
  }
}

/**
 * Batch rerank for efficiency (processes multiple queries)
 */
export async function batchRerank(
  queries: Array<{ query: string; candidates: SearchResult[] }>,
  options: RerankOptions = {}
): Promise<Map<string, RerankResult[]>> {
  const results = new Map<string, RerankResult[]>()

  // Process in parallel (with concurrency limit)
  const CONCURRENCY = 3
  const batches: Array<Array<{ query: string; candidates: SearchResult[] }>> = []

  for (let i = 0; i < queries.length; i += CONCURRENCY) {
    batches.push(queries.slice(i, i + CONCURRENCY))
  }

  for (const batch of batches) {
    const batchResults = await Promise.all(
      batch.map(({ query, candidates }) => rerankChunks(query, candidates, options))
    )

    batch.forEach(({ query }, i) => {
      results.set(query, batchResults[i])
    })
  }

  return results
}

// ============================================================================
// Contextual Content Loader
// ============================================================================

/**
 * Load contextual content for search results if available
 *
 * Looks for pre-generated context files in .contextual-index/
 */
export function loadContextForResults(results: SearchResult[]): SearchResult[] {
  const fs = require("fs")
  const path = require("path")

  const contextDir = path.resolve(process.cwd(), ".contextual-index")

  if (!fs.existsSync(contextDir)) {
    return results
  }

  return results.map((result) => {
    // Try to find context file for this result
    const contextFileName = result.file
      .replace(/\//g, "_")
      .replace(/\.ts$/, ".chunk0.json")
    const contextPath = path.join(contextDir, contextFileName)

    if (fs.existsSync(contextPath)) {
      try {
        const contextData = JSON.parse(fs.readFileSync(contextPath, "utf-8"))
        return {
          ...result,
          context: contextData.context,
        }
      } catch {
        return result
      }
    }

    return result
  })
}

// ============================================================================
// Exports
// ============================================================================

export default {
  rerankChunks,
  batchRerank,
  loadContextForResults,
}
