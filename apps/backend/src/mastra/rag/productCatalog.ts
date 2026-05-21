// @ts-nocheck
/**
 * Product semantic-search index.
 *
 * One row per published product, embedded title + subtitle + description +
 * tags + categories + select metadata, stored in PgVector under the
 * `product_search_v1` index. Drives /store/ai/search.
 *
 * Mirrors the structure of mastra/rag/adminCatalog.ts but kept separate so
 * the admin RAG (which indexes API endpoints) and the storefront search
 * (which indexes products) can evolve independently.
 *
 * Embedding provider selection (env: PRODUCT_SEARCH_EMBED_PROVIDER):
 *   • hf_local   — Xenova/all-MiniLM-L6-v2, 384 dims, runs in-process (default)
 *   • google     — text-embedding-004, 768 dims, needs GOOGLE_GENERATIVE_AI_API_KEY
 *   • dashscope  — text-embedding-v3, 1024 dims, needs DASHSCOPE_API_KEY (user has credits)
 *
 * IMPORTANT: switching providers changes the vector dimension, which is
 * incompatible with the existing PgVector index. Changing provider means:
 *   1. drop product_search_v1 in PG (or bump INDEX_NAME)
 *   2. re-run scripts/backfill-product-search.ts
 * There's no on-the-fly fallback for embeddings — it's a one-time choice.
 * The LLM extraction layer (extract.ts) DOES fall back across providers
 * because each call is independent, but embeddings have to commit.
 */
import { createOpenAI } from "@ai-sdk/openai"
import { PgVector } from "@mastra/pg"
import { embedMany } from "ai"
import { google } from "@ai-sdk/google"
import crypto from "crypto"

const INDEX_NAME = "product_search_v1"
const HF_DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2"
const GOOGLE_EMBEDDING_MODEL = "text-embedding-004"
const DASHSCOPE_EMBEDDING_MODEL = "text-embedding-v3"

// ── Embedding provider ─────────────────────────────────────────────────

type EmbeddingProvider = "google" | "hf_local" | "dashscope"

const getEmbeddingProvider = (): EmbeddingProvider => {
  // Storefront search has its own env so it can be tuned independently
  // from the admin RAG (which indexes API endpoints, not products).
  // Falls back to ADMIN_RAG_EMBED_PROVIDER for backwards compat.
  const p = String(
    process.env.PRODUCT_SEARCH_EMBED_PROVIDER ||
      process.env.ADMIN_RAG_EMBED_PROVIDER ||
      "hf_local"
  )
    .trim()
    .toLowerCase()
  if (p === "google") return "google"
  if (p === "dashscope" || p === "qwen") return "dashscope"
  return "hf_local"
}

let hfExtractorPromise: Promise<any> | null = null
const getHfExtractor = async () => {
  if (hfExtractorPromise) return hfExtractorPromise
  hfExtractorPromise = (async () => {
    const { pipeline } = await import("@xenova/transformers")
    const model = String(
      process.env.PRODUCT_SEARCH_HF_MODEL ||
        process.env.ADMIN_RAG_HF_MODEL ||
        HF_DEFAULT_MODEL
    )
    return pipeline("feature-extraction", model, { quantized: true })
  })()
  return hfExtractorPromise
}

let _dashscopeClient: ReturnType<typeof createOpenAI> | null = null
const getDashscopeClient = () => {
  if (_dashscopeClient) return _dashscopeClient
  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!apiKey) {
    throw new Error(
      "PRODUCT_SEARCH_EMBED_PROVIDER=dashscope but DASHSCOPE_API_KEY is not set"
    )
  }
  _dashscopeClient = createOpenAI({
    baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    apiKey,
  })
  return _dashscopeClient
}

export const embedTexts = async (values: string[]): Promise<number[][]> => {
  if (!values.length) return []
  const provider = getEmbeddingProvider()
  if (provider === "hf_local") {
    const extractor = await getHfExtractor()
    const out = await extractor(values, { pooling: "mean", normalize: true })
    const list =
      out && typeof out.tolist === "function" ? out.tolist() : out
    return Array.isArray(list[0]) ? (list as number[][]) : [list as number[]]
  }
  if (provider === "dashscope") {
    const ds = getDashscopeClient()
    const modelId =
      process.env.PRODUCT_SEARCH_DASHSCOPE_MODEL || DASHSCOPE_EMBEDDING_MODEL
    const { embeddings } = await embedMany({
      model: ds.embedding(modelId),
      values,
    })
    return embeddings as number[][]
  }
  // Google path. We rely on the AI SDK's embedMany so the wire format
  // shake-out is handled for us.
  const { embeddings } = await embedMany({
    model: google.embedding(GOOGLE_EMBEDDING_MODEL),
    values,
  })
  return embeddings as number[][]
}

// ── Vector store ───────────────────────────────────────────────────────

let _store: PgVector | null = null
const getStore = (): PgVector => {
  if (_store) return _store
  const conn =
    process.env.POSTGRES_CONNECTION_STRING || process.env.DATABASE_URL
  if (!conn) throw new Error("DATABASE_URL not set — required for PgVector")
  _store = new PgVector({ connectionString: conn })
  return _store
}

const ensureIndex = async (dim: number): Promise<void> => {
  const store = getStore()
  try {
    const existing = await store.listIndexes?.()
    if (Array.isArray(existing) && existing.includes(INDEX_NAME)) return
  } catch {
    // listIndexes may not be supported — fall through and try to create.
  }
  try {
    await store.createIndex?.({
      indexName: INDEX_NAME,
      dimension: dim,
      metric: "cosine",
    })
  } catch {
    // Positional signature fallback (older mastra/pg).
    try {
      await store.createIndex?.(INDEX_NAME, dim, "cosine")
    } catch {
      // best-effort
    }
  }
}

// ── Source-text builder ────────────────────────────────────────────────

/**
 * Concatenated text used as the embedding source. Order matters slightly
 * — title first, then merchandising-relevant fields, then tags/categories
 * — because some embedders weight earlier tokens.
 *
 * Sanitization: collapse whitespace, strip HTML-y angle brackets, cap at
 * ~2000 chars so the embedder doesn't truncate weird mid-sentence.
 */
type ProductLike = {
  id: string
  handle?: string | null
  title?: string | null
  subtitle?: string | null
  description?: string | null
  material?: string | null
  tags?: Array<{ value?: string | null }> | null
  categories?: Array<{ name?: string | null }> | null
  collection?: { title?: string | null } | null
  type?: { value?: string | null } | null
}

export const buildIndexedText = (product: ProductLike): string => {
  const parts: string[] = []
  const push = (v: string | null | undefined) => {
    if (!v) return
    const cleaned = String(v).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    if (cleaned) parts.push(cleaned)
  }
  push(product.title)
  push(product.subtitle)
  push(product.collection?.title)
  push(product.type?.value)
  push(product.material)
  for (const c of product.categories ?? []) push(c?.name)
  for (const t of product.tags ?? []) push(t?.value)
  push(product.description)
  const joined = parts.join(". ").slice(0, 2000)
  return joined
}

export const hashText = (text: string): string =>
  crypto.createHash("sha256").update(text).digest("hex").slice(0, 16)

// ── Upsert ─────────────────────────────────────────────────────────────

export type IndexableProduct = ProductLike

export type UpsertResult = {
  upserted: number
  skipped: number
  errors: number
}

/**
 * Embed and upsert a batch of products. Idempotent: products whose
 * `indexed_text` hash matches the value already stored in the vector
 * metadata are skipped — re-running the backfill or the subscriber on
 * unchanged products costs almost nothing.
 *
 * Skip detection requires reading existing metadata, which PgVector
 * doesn't expose directly. We fetch a probe vector by id; if it comes
 * back with the same text_hash, we skip the re-embed.
 */
export const upsertProducts = async (
  products: IndexableProduct[]
): Promise<UpsertResult> => {
  const result: UpsertResult = { upserted: 0, skipped: 0, errors: 0 }
  if (!products.length) return result

  const candidates = products.map((p) => {
    const text = buildIndexedText(p)
    return {
      id: `product:${p.id}`,
      product_id: p.id,
      handle: p.handle ?? null,
      title: p.title ?? null,
      thumbnail: (p as any).thumbnail ?? null,
      text,
      text_hash: hashText(text),
    }
  })

  // Probe existing metadata so we can skip unchanged products.
  const store = getStore()
  const idsToCheck = candidates.map((c) => c.id)
  let existing: Record<string, string> = {}
  try {
    const probe = await (store as any).query?.({
      indexName: INDEX_NAME,
      queryVector: new Array(384).fill(0),
      topK: candidates.length,
      filter: { id: { $in: idsToCheck } },
    })
    for (const row of probe ?? []) {
      const id = row?.id ?? row?.metadata?.id
      const h = row?.metadata?.text_hash
      if (typeof id === "string" && typeof h === "string") existing[id] = h
    }
  } catch {
    // No probe possible — every candidate gets re-embedded. Slower but safe.
  }

  const toEmbed = candidates.filter((c) => existing[c.id] !== c.text_hash)
  result.skipped = candidates.length - toEmbed.length
  if (!toEmbed.length) return result

  // Batch embed in chunks of 64 to keep memory + per-call latency reasonable.
  const BATCH = 64
  const vectors: number[][] = []
  for (let i = 0; i < toEmbed.length; i += BATCH) {
    const slice = toEmbed.slice(i, i + BATCH)
    try {
      const embeddings = await embedTexts(slice.map((c) => c.text))
      vectors.push(...embeddings)
    } catch (e) {
      console.warn("[productCatalog] embed batch failed", (e as any)?.message)
      result.errors += slice.length
      // Push placeholder vectors so indices stay aligned, then filter.
      for (let j = 0; j < slice.length; j++) vectors.push([])
    }
  }

  const aligned = toEmbed
    .map((c, i) => ({ candidate: c, vector: vectors[i] }))
    .filter((x) => Array.isArray(x.vector) && x.vector.length > 0)

  if (!aligned.length) return result

  await ensureIndex(aligned[0]!.vector.length)

  try {
    await store.upsert({
      indexName: INDEX_NAME,
      vectors: aligned.map((x) => x.vector),
      ids: aligned.map((x) => x.candidate.id),
      metadata: aligned.map((x) => ({
        product_id: x.candidate.product_id,
        handle: x.candidate.handle,
        title: x.candidate.title,
        thumbnail: x.candidate.thumbnail,
        text_hash: x.candidate.text_hash,
        indexed_at: new Date().toISOString(),
      })),
    })
    result.upserted = aligned.length
  } catch (e) {
    console.warn("[productCatalog] upsert failed", (e as any)?.message)
    result.errors += aligned.length
  }

  return result
}

// ── Search ─────────────────────────────────────────────────────────────

export type ProductSearchHit = {
  product_id: string
  handle: string | null
  title: string | null
  thumbnail: string | null
  score: number
}

/**
 * Vector-only similarity search. Returns top-K hits by cosine
 * similarity, leaving any post-filtering (e.g. price ranges that the
 * caller knows about) to the caller.
 */
export const searchProducts = async (
  query: string,
  topK = 12
): Promise<ProductSearchHit[]> => {
  if (!query.trim()) return []
  let queryVector: number[] = []
  try {
    const [v] = await embedTexts([query])
    queryVector = Array.isArray(v) ? v : []
  } catch (e) {
    console.warn("[productCatalog] query embed failed", (e as any)?.message)
    return []
  }
  if (!queryVector.length) return []

  const store = getStore()
  let results: any[] = []
  try {
    results = await store.query({
      indexName: INDEX_NAME,
      queryVector,
      topK,
    })
  } catch (e) {
    console.warn("[productCatalog] vector query failed", (e as any)?.message)
    return []
  }

  return (results ?? [])
    .map((r: any) => ({
      product_id: r?.metadata?.product_id ?? r?.id?.replace(/^product:/, ""),
      handle: r?.metadata?.handle ?? null,
      title: r?.metadata?.title ?? null,
      thumbnail: r?.metadata?.thumbnail ?? null,
      score: typeof r?.score === "number" ? r.score : 0,
    }))
    .filter((h) => typeof h.product_id === "string" && h.product_id.length > 0)
}

export const PRODUCT_SEARCH_INDEX = INDEX_NAME
