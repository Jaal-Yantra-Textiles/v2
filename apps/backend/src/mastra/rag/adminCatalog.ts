// @ts-nocheck
import { embedMany } from "ai"
import { PgVector } from "@mastra/pg"
import { google } from "@ai-sdk/google"

type EmbeddingProvider = "google" | "hf_local"

function getEmbeddingProvider(): EmbeddingProvider {
  const p = String(process.env.ADMIN_RAG_EMBED_PROVIDER || "google").trim().toLowerCase()
  if (p === "hf" || p === "hf_local" || p === "huggingface" || p === "huggingface_local") return "hf_local"
  return "google"
}

function shouldUseEmbeddings(): boolean {
  if (process.env.MASTRA_DISABLE_EMBEDDINGS === "true") return false
  const provider = getEmbeddingProvider()
  if (provider === "hf_local") return true
  return process.env.MASTRA_ENABLE_EMBEDDINGS === "true" && !!process.env.GOOGLE_GENERATIVE_AI_API_KEY
}

let hfExtractorPromise: Promise<any> | null = null
async function getHfExtractor() {
  if (hfExtractorPromise) return hfExtractorPromise
  hfExtractorPromise = (async () => {
    const { pipeline } = await import("@xenova/transformers")
    const model = String(process.env.ADMIN_RAG_HF_MODEL || "Xenova/all-MiniLM-L6-v2")
    const quantized = String(process.env.ADMIN_RAG_HF_QUANTIZED || "true") !== "false"
    return pipeline("feature-extraction", model, { quantized })
  })()
  return hfExtractorPromise
}

async function embedTexts(values: string[]): Promise<any[]> {
  const provider = getEmbeddingProvider()
  if (provider === "hf_local") {
    const extractor = await getHfExtractor()
    // `pooling: mean` + `normalize: true` yields sentence-embedding style vectors.
    const out = await extractor(values, { pooling: "mean", normalize: true })
    // Xenova can return a Tensor-like object; `.tolist()` gives plain arrays.
    if (out && typeof out.tolist === "function") return out.tolist()
    return out
  }

  const { embeddings } = await embedMany({
    model: google.textEmbeddingModel("gemini-embedding-001"),
    values,
  })
  return embeddings as any[]
}

function embeddingsEnabled(): boolean {
  // Backwards-compatible helper.
  return shouldUseEmbeddings()
}

function sanitizeIndexName(name: string): string {
  let n = String(name || "").toLowerCase()
  n = n.replace(/[^a-z0-9_]/g, "_")
  if (!/^[a-z_]/.test(n)) n = `_${n}`
  if (n.length > 63) n = n.slice(0, 63)
  return n
}

// Convenience helper: run RAG query then filter results using metadata keys such as path
export async function queryAdminEndpointsFiltered(
  query: string,
  opts?: { method?: string; topK?: number; exactPath?: string; pathStartsWith?: string; pathIncludes?: string }
) {
  const method = opts?.method
  const topK = opts?.topK ?? 5
  // Fetch a larger pool before filtering so we don't miss relevant endpoints
  // when lexical/vector ranking returns unrelated endpoints in the topK.
  const preFilterTopK = Math.max(topK * 20, 50)
  const results = await queryAdminEndpoints(query, method, preFilterTopK)
  const exact = (p?: string) => (x: any) => (x?.path || "") === p
  const starts = (p?: string) => (x: any) => (x?.path || "").startsWith(String(p))
  const incl = (p?: string) => (x: any) => (x?.path || "").includes(String(p))
  let filtered = Array.isArray(results) ? results.slice() : []
  if (opts?.exactPath) filtered = filtered.filter(exact(opts.exactPath))
  if (opts?.pathStartsWith) filtered = filtered.filter(starts(opts.pathStartsWith))
  if (opts?.pathIncludes) filtered = filtered.filter(incl(opts.pathIncludes))
  return filtered.slice(0, topK)
}

const ADMIN_RAG_INDEX_BASE = sanitizeIndexName(process.env.ADMIN_RAG_INDEX_NAME || "admin_endpoints")
const ADMIN_RAG_INDEX_VERSION = sanitizeIndexName(process.env.ADMIN_RAG_INDEX_VERSION || "v2")
const ADMIN_RAG_INDEX = sanitizeIndexName(`${ADMIN_RAG_INDEX_BASE}_${ADMIN_RAG_INDEX_VERSION}`)
const INGEST_TTL_MS = 10 * 60 * 1000 // 10 minutes
let lastIngestAt = 0

function getPgVector() {
  const conn = process.env.POSTGRES_CONNECTION_STRING || process.env.DATABASE_URL
  if (!conn) throw new Error("Missing POSTGRES_CONNECTION_STRING or DATABASE_URL for pgvector")
  return new PgVector({ connectionString: conn })
}

async function ensurePgIndexExists(store: any, indexName: string, dimension: number) {
  try {
    if (!dimension || dimension <= 0) throw new Error("Invalid embedding dimension")
    let exists = false
    try {
      const indexes = await store.listIndexes?.()
      if (Array.isArray(indexes)) exists = indexes.includes(indexName)
    } catch { }
    if (!exists) {
      try {
        // Prefer object signature
        await store.createIndex?.({ indexName, dimension, metric: "cosine" })
      } catch {
        // Fallback to positional signature
        await store.createIndex?.(indexName, dimension, "cosine")
      }
    }
  } catch (e) {
    try { console.warn("[RAG] ensurePgIndexExists warn:", (e as any)?.message || e) } catch { }
  }
}

function toAbsolute(u: string): string {
  const uu = String(u || "").trim()
  if (!uu) return ""
  if (/^https?:\/\//i.test(uu)) return uu
  const base = process.env.ADMIN_OPENAPI_BASE_URL || process.env.MEDUSA_BACKEND_URL || process.env.URL || ""
  if (!base) return ""
  return `${base.replace(/\/$/, "")}/${uu.replace(/^\//, "")}`
}

function buildAuthHeader(): Record<string, string> {
  const headers: Record<string, string> = {}
  const headerOverride = process.env.ADMIN_OPENAPI_CATALOG_HEADER
  const token = process.env.ADMIN_OPENAPI_CATALOG_TOKEN
  if (headerOverride) headers["Authorization"] = headerOverride
  else if (token) {
    const trimmed = String(token).trim()
    // If the user provided a full Authorization value, keep it.
    if (/^(Bearer|Basic)\s+/i.test(trimmed)) {
      headers["Authorization"] = trimmed
    } else {
      // Default to Basic base64("<token>:") which matches how the rest of the codebase
      // fetches the admin OpenAPI catalog.
      const basic = `Basic ${Buffer.from(`${trimmed}:`).toString("base64")}`
      headers["Authorization"] = basic
    }
  }
  return headers
}

async function fetchCatalogJson(): Promise<any> {
  const f = (globalThis as any)?.fetch || fetch
  const rawUrl = String(process.env.ADMIN_OPENAPI_CATALOG_URL || process.env.ADMIN_OPENAPI_CATALOG_SOURCE || "").trim()
  const url = toAbsolute(rawUrl)
  if (!url) throw new Error("No ADMIN_OPENAPI_CATALOG_URL or base URL available")
  const headers = buildAuthHeader()
  const r = await f(url, { headers })
  if (!r.ok) throw new Error(`Catalog fetch failed: ${r.status}`)
  return await r.json()
}

function summarizeSchema(schema: any): string | undefined {
  try {
    if (!schema || typeof schema !== "object") return undefined
    const s = schema.$ref ? `ref:${schema.$ref.split("/").pop()}` : schema.type || (schema.oneOf ? "oneOf" : schema.anyOf ? "anyOf" : schema.allOf ? "allOf" : undefined)
    const props = schema.properties ? Object.keys(schema.properties).slice(0, 8).join(", ") : undefined
    const items = schema.items ? (schema.items.type || (schema.items.$ref ? `ref:${String(schema.items.$ref).split("/").pop()}` : "object")) : undefined
    const req = Array.isArray(schema.required) && schema.required.length ? `required: ${schema.required.slice(0, 8).join(", ")}` : undefined
    const parts = [s ? `type: ${s}` : undefined, props ? `props: ${props}` : undefined, items ? `items: ${items}` : undefined, req]
    return parts.filter(Boolean).join("; ") || undefined
  } catch { return undefined }
}

function extractEndpoints(data: any): Array<{
  method: string
  path: string
  summary?: string
  description?: string
  operationId?: string
  tags?: string[]
  authenticated?: boolean
  security?: any
  response_codes?: string[]
  params?: Array<{ name: string; in?: string; type?: string; required?: boolean; description?: string }>
  request_schema?: string
  response_schema?: string
}> {
  const out: Array<{
    method: string
    path: string
    summary?: string
    description?: string
    operationId?: string
    tags?: string[]
    authenticated?: boolean
    security?: any
    response_codes?: string[]
    params?: Array<{ name: string; in?: string; type?: string; required?: boolean; description?: string }>
    request_schema?: string
    response_schema?: string
  }> = []
  // Support alternative catalog format with `items: [{ method, path, summary, pathParams, queryParams }]`
  const items = data?.items || data?.data?.items
  if (Array.isArray(items) && items.length) {
    for (const it of items) {
      const method = String(it?.method || "").toUpperCase()
      const rawPath = String(it?.path || "")
      if (!method || !rawPath) continue
      const path = ensureAdminPath(rawPath)
      const params: Array<{ name: string; in?: string; type?: string; required?: boolean; description?: string }> = []
      const qpSchema = Array.isArray(it?.queryParamsSchema) ? it.queryParamsSchema : []
      const qp = Array.isArray(it?.queryParams) ? it.queryParams : []
      const pp = Array.isArray(it?.pathParams) ? it.pathParams : []
      for (const n of pp) params.push({ name: String(n), in: "path" })
      for (const p of qpSchema) {
        if (!p?.name) continue
        params.push({
          name: String(p.name),
          in: "query",
          required: !!p.required,
          description: p.description,
          type: p?.schema?.type,
        })
      }
      // Add any query param names not already covered by schema entries
      for (const n of qp) {
        const exists = params.find((p) => p.in === "query" && p.name === String(n))
        if (!exists) params.push({ name: String(n), in: "query" })
      }

      const reqSchema = summarizeSchema(it?.requestBodySchema)
      const respSchema = typeof it?.responseBodySchema === "string"
        ? it.responseBodySchema
        : (it?.responseBodySchema ? JSON.stringify(it.responseBodySchema) : undefined)
      const responseCodes = Array.isArray(it?.responseCodes)
        ? it.responseCodes.map((c: any) => String(c))
        : undefined
      const tags = Array.isArray(it?.tags) ? it.tags.map((t: any) => String(t)) : undefined
      out.push({
        method,
        path,
        summary: it?.summary,
        description: it?.description,
        operationId: it?.operationId,
        tags,
        authenticated: typeof it?.authenticated === "boolean" ? it.authenticated : undefined,
        security: it?.security,
        response_codes: responseCodes,
        params,
        request_schema: reqSchema,
        response_schema: respSchema,
      })
    }
  }
  const paths = data?.paths || data?.spec?.paths || data?.openapi?.paths || data?.swagger?.paths || data?.data?.paths || data?.data?.spec?.paths || data?.data?.openapi?.paths
  if (paths && typeof paths === "object") {
    for (const p of Object.keys(paths)) {
      const methodsObj = paths[p] || {}
      for (const m of Object.keys(methodsObj)) {
        const mm = m.toUpperCase()
        if (["GET", "POST", "PUT", "PATCH", "DELETE"].includes(mm)) {
          const op = methodsObj[m] || {}
          const params = Array.isArray(op.parameters)
            ? op.parameters
              .map((pa: any) => ({
                name: pa?.name,
                in: pa?.in,
                type: pa?.schema?.type,
                required: !!pa?.required,
                description: pa?.description,
              }))
              .filter((x: any) => x.name)
            : undefined
          const reqSchema = summarizeSchema(op.requestBody?.content?.["application/json"]?.schema || op.requestBody?.content?.["application/ld+json"]?.schema)
          const respSchema = summarizeSchema(
            op.responses?.["200"]?.content?.["application/json"]?.schema ||
            op.responses?.["201"]?.content?.["application/json"]?.schema ||
            op.responses?.default?.content?.["application/json"]?.schema
          )
          const responseCodes = op?.responses && typeof op.responses === "object" ? Object.keys(op.responses) : undefined
          const tags = Array.isArray(op?.tags) ? op.tags.map((t: any) => String(t)) : undefined
          out.push({
            method: mm,
            path: p,
            summary: op.summary,
            description: op.description,
            operationId: op.operationId,
            tags,
            authenticated: typeof op?.["x-authenticated"] === "boolean" ? op["x-authenticated"] : undefined,
            security: op.security,
            response_codes: responseCodes,
            params,
            request_schema: reqSchema,
            response_schema: respSchema,
          })
        }
      }
    }
  }
  // Fallback arrays
  const arrays = [data?.endpoints, data?.routes, data?.items, data?.data?.endpoints, data?.data?.routes, data?.data?.items]
  for (const arr of arrays) {
    if (Array.isArray(arr)) {
      for (const e of arr) {
        if ((e?.method || e?.verb) && (e?.path || e?.url)) {
          out.push({ method: String(e.method || e.verb).toUpperCase(), path: String(e.path || e.url) })
        }
      }
    }
  }
  return out
}

function ensureAdminPath(path: string) {
  let p = String(path || "")
  if (!p.startsWith("/")) p = `/${p}`
  if (!p.startsWith("/admin")) p = `/admin${p}`.replace("/admin/admin/", "/admin/")
  return p.replace(/_/g, "-")
}

function buildEndpointDoc(ep: {
  method: string
  path: string
  summary?: string
  description?: string
  operationId?: string
  tags?: string[]
  authenticated?: boolean
  security?: any
  response_codes?: string[]
  params?: Array<{ name: string; in?: string; type?: string; required?: boolean; description?: string }>
  request_schema?: string
  response_schema?: string
}) {
  const body = [
    `METHOD: ${ep.method}`,
    `PATH: ${ensureAdminPath(ep.path)}`,
    ep.summary ? `SUMMARY: ${ep.summary}` : "",
    ep.description ? `DESCRIPTION: ${ep.description}` : "",
    ep.operationId ? `OPERATION_ID: ${ep.operationId}` : "",
    ep.tags && ep.tags.length ? `TAGS: ${ep.tags.slice(0, 8).join(", ")}` : "",
    typeof ep.authenticated === "boolean" ? `AUTHENTICATED: ${ep.authenticated ? "true" : "false"}` : "",
    ep.response_codes && ep.response_codes.length ? `RESPONSE_CODES: ${ep.response_codes.slice(0, 12).join(", ")}` : "",
    ep.params && ep.params.length
      ? `PARAMS:\n${ep.params
          .slice(0, 16)
          .map((p) => {
            const head = `${p.name}${p.in ? ` (${p.in})` : ""}${p.type ? `:${p.type}` : ""}${p.required ? " [required]" : ""}`
            const desc = p.description ? ` - ${String(p.description).slice(0, 140)}` : ""
            return `- ${head}${desc}`
          })
          .join("\n")}`
      : "",
    ep.request_schema ? `REQUEST: ${ep.request_schema}` : "",
    ep.response_schema ? `RESPONSE: ${ep.response_schema}` : "",
  ].filter(Boolean).join("\n")
  const searchable = `${ep.method} ${ensureAdminPath(ep.path)} ${ep.summary || ""} ${ep.description || ""} ${(ep.tags || []).join(" ")} ${ep.operationId || ""} ${ep.request_schema || ""} ${ep.response_schema || ""}`
  return {
    text: body,
    metadata: {
      method: ep.method,
      path: ensureAdminPath(ep.path),
      summary: ep.summary,
      description: ep.description,
      operationId: ep.operationId,
      tags: ep.tags,
      authenticated: ep.authenticated,
      security: ep.security,
      response_codes: ep.response_codes,
      params: ep.params,
      request_schema: ep.request_schema,
      response_schema: ep.response_schema,
      searchable,
    },
  }
}

export async function ingestAdminCatalog(force = false) {
  if (!process.env.ADMIN_OPENAPI_CATALOG_URL && !process.env.ADMIN_OPENAPI_CATALOG_SOURCE) {
    // If no source is configured, we can't ingest
    return { status: "skipped_no_source" }
  }

  // 1. Check in-memory TTL first
  if (!force && lastIngestAt > 0 && Date.now() - lastIngestAt < INGEST_TTL_MS) {
    return { status: "cached" }
  }

  const json = await fetchCatalogJson()
  const endpoints = extractEndpoints(json)
  if (!endpoints.length) return { status: "no_endpoints" }

  // Build documents: one per endpoint
  const docs = endpoints.map(buildEndpointDoc)

  const texts = docs.map((d) => d.text)
  const metas = docs.map((d) => d.metadata)

  // External embed APIs may have batch limits; keep chunking.
  const BATCH_SIZE = Math.max(1, Math.min(100, Number(process.env.ADMIN_RAG_EMBED_BATCH_SIZE || 100)))
  const embeddingsAll: any[] = []
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const slice = texts.slice(i, i + BATCH_SIZE)
    const batchEmbeddings = await embedTexts(slice)
    embeddingsAll.push(...(batchEmbeddings as any[]))
  }

  const toNumberArray = (v: any): number[] => {
    const raw = Array.isArray(v)
      ? v
      : (Array.isArray(v?.values) ? v.values : (Array.isArray(v?.embedding) ? v.embedding : []))
    if (!Array.isArray(raw)) return []
    const out = raw.map((x: any) => (typeof x === "number" && Number.isFinite(x) ? x : 0))
    // Ensure it's a real Array<number>
    return Array.isArray(out) ? out : Array.from(out as any)
  }

  // Align vectors and metadata by index; skip empty vectors
  const vectorsArr: number[][] = []
  const metasAligned: any[] = []
  const idsAligned: string[] = []
  for (let i = 0; i < (embeddingsAll as any[])?.length; i++) {
    const vec = toNumberArray((embeddingsAll as any[])[i])
    if (!vec.length) continue
    vectorsArr.push(vec)
    const meta = metas[i]
    metasAligned.push(meta)
    const stableId = `admin_endpoint:${String(meta?.method || "").toUpperCase()}:${String(meta?.path || "")}`
    idsAligned.push(stableId)
  }

  // If no vectors, skip upsert gracefully
  if (!vectorsArr.length) {
    return { status: "no_vectors", count: 0 }
  }

  // PgVector.upsert expects vectors: number[][] and optional metadata/ids arrays
  const store = getPgVector()
  // Ensure index exists (best-effort)
  const dim = vectorsArr[0]?.length || 1536
  try {
    try {
      await store.createIndex?.({ indexName: ADMIN_RAG_INDEX, dimension: dim, metric: "cosine" })
    } catch {
      await store.createIndex?.(ADMIN_RAG_INDEX, dim, "cosine")
    }
  } catch { }
  try {
    await store.upsert({
      indexName: ADMIN_RAG_INDEX,
      vectors: vectorsArr,
      ids: idsAligned,
      metadata: metasAligned,
    })
  } catch (e) {
    try {
      console.error("[RAG] upsert failed", { type0: typeof (vectorsArr[0] as any), isArray0: Array.isArray(vectorsArr[0]) })
    } catch { }
    throw e
  }
  lastIngestAt = Date.now()
  return { status: "ingested", count: vectorsArr.length }
}

export async function queryAdminEndpoints(
  query: string,
  method?: string,
  topK = 5,
  memoryContext?: { threadId?: string; memory?: any }
) {
  const lower = String(query || "").toLowerCase()
  const inferredMethod = ((): string | undefined => {
    if (method) return String(method).toUpperCase()
    if (/\b(create|add|make|new)\b/.test(lower)) return "POST"
    if (/\b(update|edit|modify|patch)\b/.test(lower)) return "PATCH"
    if (/\b(put|replace)\b/.test(lower)) return "PUT"
    if (/\b(delete|remove|archive)\b/.test(lower)) return "DELETE"
    return "GET"
  })()
  const boosted = `${inferredMethod} ${query}`
  try { console.log(`[RAG][query] start`, { index: ADMIN_RAG_INDEX, query: boosted, method: inferredMethod, topK }) } catch { }

  // 1) Try lexical match directly against the catalog as a robust fallback/primary when obvious
  const lexical = await lexicalQueryAdminEndpoints(query, inferredMethod, topK)
  if (Array.isArray(lexical) && lexical.length) {
    try { console.log(`[RAG][query] lexical hit`, { count: lexical.length, first: lexical[0] }) } catch { }
    return lexical
  }

  // If embeddings are disabled/unavailable, do not attempt vector search.
  if (!embeddingsEnabled()) {
    try { console.log(`[RAG][query] embeddings disabled; returning lexical-only (empty)`) } catch { }
    return []
  }

  const embeddings = await embedTexts([boosted])
  // Normalize single embedding shape for query
  let queryVectorRaw: any = embeddings[0]
  let queryVector: number[] = Array.isArray(queryVectorRaw)
    ? (queryVectorRaw as number[])
    : (Array.isArray(queryVectorRaw?.values)
      ? (queryVectorRaw.values as number[])
      : (Array.isArray(queryVectorRaw?.embedding) ? (queryVectorRaw.embedding as number[]) : []))
  // Sanitize to finite numbers only
  if (!Array.isArray(queryVector)) queryVector = []
  let replaced = 0
  // Ensure we have a mappable iterable (typed arrays also support map)
  queryVector = (queryVector as any).map((v: any) => {
    const n = typeof v === "number" && Number.isFinite(v) ? v : 0
    if (n !== v) replaced++
    return n
  })
  // Coerce to a real Array<number> in case it's a typed array
  queryVector = Array.isArray(queryVector) ? queryVector : Array.from(queryVector as any)
  if (!queryVector.length || replaced > 0) {
    try { console.warn(`[RAG][query] vector sanitized`, { dim: queryVector.length, replaced }) } catch { }
  }
  // If still empty or suspicious, skip querying the store to avoid errors
  if (!queryVector.length) {
    try { console.warn(`[RAG][query] skip: empty vector`) } catch { }
    return []
  }
  let store: ReturnType<typeof getPgVector>
  try {
    store = getPgVector()
  } catch (e) {
    try { console.warn(`[RAG][query] getPgVector error`, (e as any)?.message || e) } catch { }
    return []
  }
  try { console.log(`[RAG][query] vector`, { dim: queryVector?.length }) } catch { }
  let results: any[] = []
  try {
    // PgVector expects `queryVector`.
    results = await store.query({ indexName: ADMIN_RAG_INDEX, queryVector, topK })
  } catch (e) {
    try { console.warn(`[RAG][query] store.query error`, (e as any)?.message || e) } catch { }
    return []
  }
  try {
    console.log(`[RAG][query] raw results`, {
      count: Array.isArray(results) ? results.length : 0,
      sample: Array.isArray(results) ? results.slice(0, 3).map((r: any) => ({ score: r.score, method: r?.metadata?.method, path: r?.metadata?.path })) : [],
    })
  } catch { }
  // Map results back to endpoints if metadata contains method/path
  const endpoints = (results || [])
    .map((r: any) => ({
      method: r.metadata?.method,
      path: r.metadata?.path,
      summary: r.metadata?.summary,
      description: r.metadata?.description,
      params: r.metadata?.params,
      request_schema: r.metadata?.request_schema,
      response_schema: r.metadata?.response_schema,
      score: r.score,
    }))
    .filter((e: any) => e.method && e.path)
  if (method) return endpoints.filter((e: any) => e.method.toUpperCase() === method.toUpperCase())
  try { console.log(`[RAG][query] endpoints`, { count: endpoints.length, first: endpoints[0] }) } catch { }
  return endpoints
}

export async function queryAdminEndpointsVectorOnly(
  query: string,
  opts?: { topK?: number; method?: string }
) {
  const topK = Math.max(1, Math.min(50, Number(opts?.topK ?? 10)))
  const method = opts?.method ? String(opts.method).toUpperCase() : undefined

  if (!embeddingsEnabled()) {
    return {
      ok: false,
      error: "embeddings_disabled",
      indexName: ADMIN_RAG_INDEX,
      provider: getEmbeddingProvider(),
      results: [],
    }
  }

  const boosted = method ? `${method} ${query}` : String(query || "")
  const embeddings = await embedTexts([boosted])

  let queryVectorRaw: any = embeddings?.[0]
  let queryVector: number[] = Array.isArray(queryVectorRaw)
    ? (queryVectorRaw as number[])
    : (Array.isArray(queryVectorRaw?.values)
      ? (queryVectorRaw.values as number[])
      : (Array.isArray(queryVectorRaw?.embedding) ? (queryVectorRaw.embedding as number[]) : []))

  if (!Array.isArray(queryVector)) queryVector = []
  queryVector = (queryVector as any).map((v: any) => {
    const n = typeof v === "number" && Number.isFinite(v) ? v : 0
    return n
  })
  queryVector = Array.isArray(queryVector) ? queryVector : Array.from(queryVector as any)

  if (!queryVector.length) {
    return {
      ok: false,
      error: "empty_query_vector",
      indexName: ADMIN_RAG_INDEX,
      provider: getEmbeddingProvider(),
      results: [],
    }
  }

  let store: ReturnType<typeof getPgVector>
  try {
    store = getPgVector()
  } catch (e) {
    return {
      ok: false,
      error: (e as any)?.message || String(e),
      indexName: ADMIN_RAG_INDEX,
      provider: getEmbeddingProvider(),
      results: [],
    }
  }

  let results: any[] = []
  try {
    results = await store.query({ indexName: ADMIN_RAG_INDEX, queryVector, topK })
  } catch (e) {
    return {
      ok: false,
      error: (e as any)?.message || String(e),
      indexName: ADMIN_RAG_INDEX,
      provider: getEmbeddingProvider(),
      results: [],
    }
  }

  const shaped = (results || []).map((r: any) => ({
    score: r?.score,
    metadata: r?.metadata,
  }))

  const bestByKey = new Map<string, { score: any; metadata: any }>()
  for (const r of shaped) {
    const m = r?.metadata || {}
    const key = `${String(m?.method || "").toUpperCase()} ${String(m?.path || "")}`.trim()
    if (!key) continue
    const existing = bestByKey.get(key)
    if (!existing || (typeof r?.score === "number" && typeof existing.score === "number" && r.score > existing.score)) {
      bestByKey.set(key, r)
    }
  }
  const dedupedResults = Array.from(bestByKey.values()).sort((a: any, b: any) => {
    const aa = typeof a?.score === "number" ? a.score : -Infinity
    const bb = typeof b?.score === "number" ? b.score : -Infinity
    return bb - aa
  })

  return {
    ok: true,
    indexName: ADMIN_RAG_INDEX,
    provider: getEmbeddingProvider(),
    query: boosted,
    topK,
    rawCount: shaped.length,
    dedupedCount: dedupedResults.length,
    results: shaped,
    dedupedResults,
  }
}

// Simple lexical search over the OpenAPI catalog without embeddings
async function lexicalQueryAdminEndpoints(query: string, method?: string, topK = 5) {
  try { console.log(`[RAG][lex] start`, { topK }) } catch { }
  let json: any
  try {
    json = await fetchCatalogJson()
  } catch (e) {
    try { console.warn(`[RAG][lex] fetch error`, (e as any)?.message || e) } catch { }
    return []
  }
  const endpoints = extractEndpoints(json)
  if (!Array.isArray(endpoints) || !endpoints.length) return []

  // Fast-path: if the user/query already contains an explicit canonical path, return exact matches.
  // This prevents scoring filters from accidentally dropping obvious requests like:
  // "GET /admin/designs".
  try {
    const explicit = String(query || "").match(/\b(get|post|put|patch|delete)\s+(\/(?:admin|store)\/[^\s]+)\b/i)
    const explicitMethod = explicit?.[1] ? String(explicit[1]).toUpperCase() : undefined
    const explicitPathRaw = explicit?.[2] ? String(explicit[2]) : undefined
    const explicitPath = explicitPathRaw ? ensureAdminPath(explicitPathRaw.split("?")[0]) : undefined
    if (explicitPath) {
      const exact = endpoints.filter((e: any) => ensureAdminPath(e.path).split("?")[0] === explicitPath)
      const filtered = explicitMethod ? exact.filter((e: any) => String(e.method).toUpperCase() === explicitMethod) : exact
      if (filtered.length) {
        return filtered.slice(0, Math.max(1, topK)).map((e: any) => ({
          method: String(e.method).toUpperCase(),
          path: ensureAdminPath(e.path),
          summary: e.summary,
          description: e.description,
          params: e.params,
          request_schema: e.request_schema,
          response_schema: e.response_schema,
          score: 999,
        }))
      }
    }
  } catch { }
  const q = String(query || "").toLowerCase()
  const tokens = q.replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean)
  // very light stemming and normalization
  const norm = (t: string) => {
    if (!t) return t
    if (t === "products" || t === "product") return "product"
    if (t === "designs" || t === "design") return "design"
    if (t.length > 4 && /s$/.test(t)) return t.slice(0, -1) // plural to singular heuristic
    return t
  }
  // Remove generic chat/intent words and generic API terms that cause false matches.
  const stop = new Set([
    "i", "you", "we", "they", "he", "she", "it", "my", "your", "me", "us", "them",
    "would", "like", "please", "want", "need", "can", "could", "should", "will",
    "show", "list", "get", "fetch", "find", "search", "return", "give",
    "a", "an", "the", "of", "to", "for", "from", "in", "on", "at", "by", "with", "and", "or", "as",
    "named", "name", "called", "about",
    "admin", "endpoint", "endpoints", "route", "routes",
    // 'api' is too generic and often causes /admin/api-keys to win
    "api",
  ])

  const stemmed = tokens.map(norm).filter((t) => t && !stop.has(t))
  const wantsProduct = stemmed.includes("product")
  const wantsDesign = stemmed.includes("design")
  const wantsApiKeys = /\bapi\s*-?\s*keys?\b/.test(q) || stemmed.includes("key") || stemmed.includes("keys")
  const wantsPartner = /\bpartners?\b/.test(q) || stemmed.includes("partner")
  const wantsFeedback = /\bfeedbacks?\b/.test(q) || stemmed.includes("feedback")

  const isSensitivePath = (p: string) => {
    const pathOnly = String(p || "").toLowerCase()
    return (
      pathOnly.includes("/api-keys") ||
      pathOnly.includes("/invite") ||
      pathOnly.includes("/auth")
    )
  }

  const segmentBoost = (pathOnly: string, token: string) => {
    const segs = pathOnly.split("/").filter(Boolean)
    for (const s of segs) {
      if (s === token) return 4
      if (s === `${token}s`) return 4
      if (token.length > 3 && s.includes(token)) return 2
    }
    return 0
  }

  function score(ep: any): { s: number; tokenHits: number } {
    let s = 0
    let tokenHits = 0
    const methodMatch = method ? (String(ep.method).toUpperCase() === String(method).toUpperCase()) : true
    if (!methodMatch) s -= 2
    const pathCanonical = ensureAdminPath(ep.path)
    const tags = Array.isArray(ep?.tags) ? ep.tags.join(" ") : ""
    const opId = ep?.operationId ? String(ep.operationId) : ""
    const paramText = Array.isArray(ep?.params)
      ? ep.params
          .slice(0, 32)
          .map((p: any) => `${p?.name || ""} ${p?.description || ""}`.trim())
          .filter(Boolean)
          .join(" ")
      : ""
    const hay = `${ep.method} ${pathCanonical} ${ep.summary || ""} ${ep.description || ""} ${tags} ${opId} ${paramText} ${ep.request_schema || ""} ${ep.response_schema || ""}`.toLowerCase()

    // Strongly de-prioritize sensitive endpoints unless explicitly requested.
    if (isSensitivePath(pathCanonical) && !wantsApiKeys) s -= 12

    for (const t of stemmed) {
      if (!t || t.length < 3) continue
      if (hay.includes(t)) {
        s += 1
        tokenHits += 1
      }
    }
    // Boost if tokens appear in path segments
    const pathOnly = pathCanonical.toLowerCase()
    for (const t of stemmed) {
      if (t.length >= 3 && pathOnly.includes(t)) {
        s += 2 // stronger weight for path matches
        tokenHits += 1
      }
      const b = segmentBoost(pathOnly, t)
      if (b > 0) {
        s += b
        tokenHits += 1
      }
    }
    // Small bias for GET listing when query contains list-like words, but only when we had at least one meaningful match.
    if (tokenHits > 0 && /\b(list|all|get|show|fetch)\b/.test(q) && ep.method === "GET") s += 1
    // Strong product intent handling
    if (wantsProduct) {
      if (/\/admin\/(products|product)(\b|\/)/.test(pathOnly)) s += 3
      if (pathOnly.includes("/api-keys")) s -= 4
    }

    // Strong designs intent handling
    if (wantsDesign) {
      if (/\/admin\/(designs|design)(\b|\/)/.test(pathOnly)) s += 5
      if (pathOnly.includes("/api-keys")) s -= 8
    }

    // Strong partners intent handling
    if (wantsPartner) {
      // Prefer the list endpoint when the user asks to list partners.
      if (/\b(list|all|show|get|fetch)\b/.test(q) && ep.method === "GET") {
        if (/^\/admin\/partners\/?$/.test(pathOnly)) s += 6
        // De-prioritize nested partner routes unless explicitly requested.
        if (!wantsFeedback && /\/admin\/partners\/\{[^}]+\}\//.test(pathOnly)) s -= 3
      }
      // If user explicitly asks for feedbacks, do the opposite.
      if (wantsFeedback && pathOnly.includes("/partners/") && pathOnly.includes("/feedback")) s += 4
    }
    return { s, tokenHits }
  }

  const scored = endpoints
    .map((ep) => {
      const r = score(ep)
      return { ep, s: r.s, tokenHits: r.tokenHits }
    })
    // Don't return arbitrary endpoints with only generic bias; require at least one meaningful token match.
    .filter((x) => x.s > 0 && x.tokenHits > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, topK)
    .map((x) => ({
      method: x.ep.method,
      path: ensureAdminPath(x.ep.path),
      summary: x.ep.summary,
      description: x.ep.description,
      params: x.ep.params,
      request_schema: x.ep.request_schema,
      response_schema: x.ep.response_schema,
      score: x.s,
    }))
  try { console.log(`[RAG][lex] results`, { count: scored.length, first: scored[0] }) } catch { }
  return scored
}
