/**
 * Embedding Service
 *
 * Provides local embedding generation using HuggingFace models via @xenova/transformers.
 * Uses the same pattern as adminCatalog.ts for consistency.
 *
 * Model: Xenova/all-MiniLM-L6-v2 (384 dimensions)
 * - Small, fast, runs locally
 * - Good for semantic similarity tasks
 * - No API costs
 */

// @ts-nocheck

// ─── Configuration ───────────────────────────────────────────────────────────

export const EMBEDDING_CONFIG = {
  model: process.env.AI_EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2",
  dimension: 384, // all-MiniLM-L6-v2 produces 384-dim vectors
  quantized: process.env.AI_EMBEDDING_QUANTIZED !== "false",

  // Similarity thresholds (adjusted for all-MiniLM-L6-v2)
  // Note: MiniLM produces lower scores than OpenAI embeddings, so thresholds are lower
  thresholds: {
    high: 0.5, // Can reuse plan directly
    moderate: 0.35, // May need adaptation
    // Below 0.35 = generate new plan
  },
}

// ─── HuggingFace Extractor ───────────────────────────────────────────────────

let hfExtractorPromise: Promise<any> | null = null
let modelLoadError: Error | null = null

/**
 * Get or initialize the HuggingFace feature extraction pipeline.
 * Caches the pipeline instance for reuse.
 */
async function getHfExtractor(): Promise<any> {
  if (modelLoadError) {
    throw modelLoadError
  }

  if (hfExtractorPromise) {
    return hfExtractorPromise
  }

  hfExtractorPromise = (async () => {
    try {
      console.log(
        `[embedding-service] Loading model: ${EMBEDDING_CONFIG.model} (quantized: ${EMBEDDING_CONFIG.quantized})`
      )
      const startTime = Date.now()

      const { pipeline } = await import("@xenova/transformers")
      const extractor = await pipeline("feature-extraction", EMBEDDING_CONFIG.model, {
        quantized: EMBEDDING_CONFIG.quantized,
      })

      const loadTime = Date.now() - startTime
      console.log(`[embedding-service] Model loaded in ${loadTime}ms`)

      return extractor
    } catch (error) {
      modelLoadError = error as Error
      hfExtractorPromise = null
      console.error("[embedding-service] Failed to load model:", error)
      throw error
    }
  })()

  return hfExtractorPromise
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate an embedding for a single text string.
 *
 * @param text - The text to embed
 * @returns A 384-dimensional embedding vector
 *
 * @example
 * const embedding = await embedText("Show me all partners with payments")
 * // Returns: [0.123, -0.456, 0.789, ...] (384 values)
 */
export async function embedText(text: string): Promise<number[]> {
  if (!text || typeof text !== "string") {
    throw new Error("embedText requires a non-empty string")
  }

  const extractor = await getHfExtractor()
  const out = await extractor([text], { pooling: "mean", normalize: true })

  // Handle Tensor-like objects from Xenova
  const embeddings = out && typeof out.tolist === "function" ? out.tolist() : out
  return embeddings[0]
}

/**
 * Generate embeddings for multiple text strings.
 * More efficient than calling embedText multiple times.
 *
 * @param texts - Array of texts to embed
 * @returns Array of 384-dimensional embedding vectors
 *
 * @example
 * const embeddings = await embedTexts(["query 1", "query 2", "query 3"])
 * // Returns: [[...], [...], [...]] (3 arrays of 384 values each)
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!Array.isArray(texts) || texts.length === 0) {
    return []
  }

  // Filter out empty strings
  const validTexts = texts.filter((t) => t && typeof t === "string")
  if (validTexts.length === 0) {
    return []
  }

  const extractor = await getHfExtractor()
  const out = await extractor(validTexts, { pooling: "mean", normalize: true })

  // Handle Tensor-like objects from Xenova
  return out && typeof out.tolist === "function" ? out.tolist() : out
}

/**
 * Calculate cosine similarity between two embedding vectors.
 *
 * @param a - First embedding vector
 * @param b - Second embedding vector
 * @returns Similarity score between 0 and 1
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have the same dimension")
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB)
  return magnitude === 0 ? 0 : dotProduct / magnitude
}

/**
 * Classify a similarity score into match categories.
 *
 * @param similarity - Similarity score between 0 and 1
 * @returns Match category: "high", "moderate", or "low"
 */
export function classifyMatch(similarity: number): "high" | "moderate" | "low" {
  if (similarity >= EMBEDDING_CONFIG.thresholds.high) {
    return "high"
  }
  if (similarity >= EMBEDDING_CONFIG.thresholds.moderate) {
    return "moderate"
  }
  return "low"
}

/**
 * Check if the embedding service is ready (model loaded).
 */
export function isReady(): boolean {
  return hfExtractorPromise !== null && modelLoadError === null
}

/**
 * Preload the embedding model.
 * Call this at startup to avoid first-request latency.
 */
export async function preload(): Promise<void> {
  await getHfExtractor()
}

/**
 * Clear the cached model (useful for testing).
 */
export function clearCache(): void {
  hfExtractorPromise = null
  modelLoadError = null
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EmbeddingResult {
  text: string
  embedding: number[]
  dimension: number
}

export interface SimilarityResult {
  similarity: number
  matchType: "high" | "moderate" | "low"
  canReuse: boolean
  needsAdaptation: boolean
}

/**
 * Generate embedding with metadata.
 */
export async function embedWithMetadata(text: string): Promise<EmbeddingResult> {
  const embedding = await embedText(text)
  return {
    text,
    embedding,
    dimension: embedding.length,
  }
}

/**
 * Compare two texts and return similarity analysis.
 */
export async function compareSimilarity(
  text1: string,
  text2: string
): Promise<SimilarityResult> {
  const [emb1, emb2] = await embedTexts([text1, text2])
  const similarity = cosineSimilarity(emb1, emb2)
  const matchType = classifyMatch(similarity)

  return {
    similarity,
    matchType,
    canReuse: matchType === "high",
    needsAdaptation: matchType === "moderate",
  }
}
