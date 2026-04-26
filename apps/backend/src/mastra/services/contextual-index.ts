/**
 * Contextual Index Service
 *
 * Based on Anthropic's Contextual Retrieval research:
 * https://www.anthropic.com/engineering/contextual-retrieval
 *
 * This service loads pre-generated contextual summaries and provides
 * enhanced search functionality that combines:
 * 1. BM25 lexical search
 * 2. Contextual metadata matching
 * 3. LLM-based reranking
 *
 * Expected improvement: 35-67% reduction in retrieval failures
 */

import * as fs from "fs"
import * as path from "path"
import { rerankChunks, loadContextForResults, SearchResult } from "./reranker"

// ============================================================================
// Types
// ============================================================================

export interface ContextualChunk {
  filePath: string
  chunkIndex: number
  originalContent: string
  context: string
  contextualContent: string
  metadata: {
    module: string | null
    entityType: string | null
    operation: string | null
    apiPath: string | null
    relatedEntities: string[]
  }
  generatedAt: Date
}

export interface ContextualIndex {
  version: string
  generatedAt: Date
  totalFiles: number
  totalChunks: number
  chunks: ContextualChunk[]
}

export interface ContextualSearchResult {
  file: string
  score: number
  snippet: string
  context?: string
  metadata?: ContextualChunk["metadata"]
  chunkIndex?: number
  // Fields from reranking
  rerankScore?: number
  finalScore?: number
  reasoning?: string
}

export interface ContextualSearchOptions {
  topK?: number
  useReranker?: boolean
  minScore?: number
  moduleFilter?: string[]
  entityTypeFilter?: string[]
  operationFilter?: string[]
}

// ============================================================================
// BM25 Implementation for Contextual Content
// ============================================================================

const K1 = 1.5
const B = 0.75

interface BM25Document {
  chunk: ContextualChunk
  terms: Map<string, number> // term -> frequency
  length: number
}

interface BM25Index {
  documents: BM25Document[]
  avgLength: number
  termDocFreq: Map<string, number> // term -> document count
  totalDocs: number
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s_-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2)
}

function buildBM25Index(chunks: ContextualChunk[]): BM25Index {
  const documents: BM25Document[] = []
  const termDocFreq = new Map<string, number>()
  let totalLength = 0

  for (const chunk of chunks) {
    // Index both contextual content and metadata
    const searchableText = [
      chunk.contextualContent,
      chunk.metadata.module || "",
      chunk.metadata.entityType || "",
      chunk.metadata.operation || "",
      chunk.metadata.apiPath || "",
      ...(chunk.metadata.relatedEntities || []),
    ].join(" ")

    const tokens = tokenize(searchableText)
    const termFreq = new Map<string, number>()

    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) || 0) + 1)
    }

    // Update document frequency for each unique term
    const uniqueTerms = new Set(tokens)
    for (const term of uniqueTerms) {
      termDocFreq.set(term, (termDocFreq.get(term) || 0) + 1)
    }

    documents.push({
      chunk,
      terms: termFreq,
      length: tokens.length,
    })

    totalLength += tokens.length
  }

  return {
    documents,
    avgLength: documents.length > 0 ? totalLength / documents.length : 1,
    termDocFreq,
    totalDocs: documents.length,
  }
}

function calculateBM25Score(
  queryTerms: string[],
  doc: BM25Document,
  index: BM25Index
): number {
  let score = 0

  for (const term of queryTerms) {
    const tf = doc.terms.get(term) || 0
    if (tf === 0) continue

    const df = index.termDocFreq.get(term) || 1
    const idf = Math.log(
      (index.totalDocs - df + 0.5) / (df + 0.5) + 1
    )
    const tfComponent =
      (tf * (K1 + 1)) /
      (tf + K1 * (1 - B + B * (doc.length / index.avgLength)))

    score += idf * tfComponent
  }

  return score
}

// ============================================================================
// Contextual Index Service
// ============================================================================

export class ContextualIndexService {
  private indexPath: string
  private index: ContextualIndex | null = null
  private bm25Index: BM25Index | null = null
  private loaded: boolean = false

  constructor(projectRoot: string = process.cwd()) {
    this.indexPath = path.join(projectRoot, ".contextual-index", "contextual-index.json")
  }

  /**
   * Load the contextual index from disk
   */
  async load(): Promise<boolean> {
    if (this.loaded && this.index) {
      return true
    }

    try {
      if (!fs.existsSync(this.indexPath)) {
        console.log("[ContextualIndex] Index file not found at:", this.indexPath)
        return false
      }

      const content = fs.readFileSync(this.indexPath, "utf-8")
      this.index = JSON.parse(content) as ContextualIndex

      // Build BM25 index for fast search
      this.bm25Index = buildBM25Index(this.index.chunks)
      this.loaded = true

      console.log(
        `[ContextualIndex] Loaded ${this.index.totalChunks} chunks from ${this.index.totalFiles} files`
      )
      return true
    } catch (error) {
      console.error("[ContextualIndex] Failed to load index:", error)
      return false
    }
  }

  /**
   * Check if index is loaded
   */
  isLoaded(): boolean {
    return this.loaded && this.index !== null
  }

  /**
   * Get index statistics
   */
  getStats(): { totalFiles: number; totalChunks: number; version: string } | null {
    if (!this.index) return null
    return {
      totalFiles: this.index.totalFiles,
      totalChunks: this.index.totalChunks,
      version: this.index.version,
    }
  }

  /**
   * Search the contextual index using BM25
   */
  async search(
    query: string,
    options: ContextualSearchOptions = {}
  ): Promise<ContextualSearchResult[]> {
    const {
      topK = 20,
      useReranker = true,
      minScore = 0.1,
      moduleFilter,
      entityTypeFilter,
      operationFilter,
    } = options

    // Ensure index is loaded
    if (!this.loaded) {
      await this.load()
    }

    if (!this.index || !this.bm25Index) {
      console.warn("[ContextualIndex] Index not available")
      return []
    }

    const queryTerms = tokenize(query)
    if (queryTerms.length === 0) {
      return []
    }

    // Add variations of query terms (similar to hybrid-query-resolver)
    const expandedTerms: string[] = [...queryTerms]
    for (const term of queryTerms) {
      // Add capitalized version
      expandedTerms.push(term.charAt(0).toUpperCase() + term.slice(1))
      // Add plural
      if (!term.endsWith("s")) {
        expandedTerms.push(term + "s")
      }
      // Add _id suffix
      expandedTerms.push(term + "_id")
    }
    const uniqueTerms = [...new Set(expandedTerms)]

    // Calculate BM25 scores
    const scored: Array<{
      doc: BM25Document
      score: number
    }> = []

    for (const doc of this.bm25Index.documents) {
      // Apply filters
      const chunk = doc.chunk

      if (moduleFilter && moduleFilter.length > 0) {
        if (!chunk.metadata.module || !moduleFilter.includes(chunk.metadata.module)) {
          continue
        }
      }

      if (entityTypeFilter && entityTypeFilter.length > 0) {
        if (!chunk.metadata.entityType || !entityTypeFilter.includes(chunk.metadata.entityType)) {
          continue
        }
      }

      if (operationFilter && operationFilter.length > 0) {
        if (!chunk.metadata.operation || !operationFilter.includes(chunk.metadata.operation)) {
          continue
        }
      }

      const score = calculateBM25Score(uniqueTerms, doc, this.bm25Index!)

      if (score > minScore) {
        scored.push({ doc, score })
      }
    }

    // Sort by score
    scored.sort((a, b) => b.score - a.score)

    // Take top candidates (more than topK for reranking)
    const candidates = scored.slice(0, useReranker ? topK * 3 : topK)

    // Convert to search results
    const results: ContextualSearchResult[] = candidates.map(({ doc, score }) => ({
      file: doc.chunk.filePath,
      score,
      snippet: doc.chunk.originalContent.slice(0, 800),
      context: doc.chunk.context,
      metadata: doc.chunk.metadata,
      chunkIndex: doc.chunk.chunkIndex,
    }))

    // Apply reranking if enabled
    if (useReranker && results.length > 0) {
      console.log(`[ContextualIndex] Reranking ${results.length} candidates`)

      const searchResults: SearchResult[] = results.map((r) => ({
        file: r.file,
        score: r.score,
        snippet: r.snippet,
        context: r.context,
      }))

      const reranked = await rerankChunks(query, searchResults, {
        topK,
        candidateLimit: topK * 3,
        minScore: 4,
        includeReasoning: false,
      })

      // Map back with reranking scores
      return reranked.map((r) => {
        const original = results.find((o) => o.file === r.file)
        return {
          file: r.file,
          score: r.score,
          snippet: r.snippet,
          context: r.context,
          metadata: original?.metadata,
          chunkIndex: original?.chunkIndex,
          rerankScore: r.rerankScore,
          finalScore: r.finalScore,
          reasoning: r.reasoning,
        }
      })
    }

    return results.slice(0, topK)
  }

  /**
   * Search by metadata fields (fast lookup)
   */
  searchByMetadata(options: {
    module?: string
    entityType?: string
    operation?: string
    apiPath?: string
  }): ContextualChunk[] {
    if (!this.index) return []

    return this.index.chunks.filter((chunk) => {
      if (options.module && chunk.metadata.module !== options.module) return false
      if (options.entityType && chunk.metadata.entityType !== options.entityType) return false
      if (options.operation && chunk.metadata.operation !== options.operation) return false
      if (options.apiPath && chunk.metadata.apiPath !== options.apiPath) return false
      return true
    })
  }

  /**
   * Get context for a specific file
   */
  getContextForFile(filePath: string): ContextualChunk[] {
    if (!this.index) return []
    return this.index.chunks.filter((chunk) => chunk.filePath === filePath)
  }

  /**
   * Get all unique modules
   */
  getModules(): string[] {
    if (!this.index) return []
    const modules = new Set<string>()
    for (const chunk of this.index.chunks) {
      if (chunk.metadata.module) {
        modules.add(chunk.metadata.module)
      }
    }
    return [...modules].sort()
  }

  /**
   * Get all unique entity types
   */
  getEntityTypes(): string[] {
    if (!this.index) return []
    const types = new Set<string>()
    for (const chunk of this.index.chunks) {
      if (chunk.metadata.entityType) {
        types.add(chunk.metadata.entityType)
      }
    }
    return [...types].sort()
  }

  /**
   * Get chunks with their full context for LLM consumption
   */
  getContextualChunks(
    query: string,
    options: ContextualSearchOptions = {}
  ): Promise<Array<{
    file: string
    context: string
    content: string
    metadata: ContextualChunk["metadata"]
  }>> {
    return this.search(query, options).then((results) =>
      results.map((r) => {
        const chunk = this.index?.chunks.find(
          (c) => c.filePath === r.file && c.chunkIndex === r.chunkIndex
        )
        return {
          file: r.file,
          context: r.context || "",
          content: chunk?.originalContent || r.snippet,
          metadata: r.metadata || {
            module: null,
            entityType: null,
            operation: null,
            apiPath: null,
            relatedEntities: [],
          },
        }
      })
    )
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: ContextualIndexService | null = null

export function getContextualIndexService(): ContextualIndexService {
  if (!instance) {
    instance = new ContextualIndexService()
  }
  return instance
}

export default ContextualIndexService
