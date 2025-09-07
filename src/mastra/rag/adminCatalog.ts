// @ts-nocheck
import { MDocument } from "@mastra/rag"
import { embedMany } from "ai"
import { openai } from "@ai-sdk/openai"
import { PgVector } from "@mastra/pg"

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
  const results = await queryAdminEndpoints(query, method, topK)
  const exact = (p?: string) => (x: any) => (x?.path || "") === p
  const starts = (p?: string) => (x: any) => (x?.path || "").startsWith(String(p))
  const incl = (p?: string) => (x: any) => (x?.path || "").includes(String(p))
  let filtered = Array.isArray(results) ? results.slice() : []
  if (opts?.exactPath) filtered = filtered.filter(exact(opts.exactPath))
  if (opts?.pathStartsWith) filtered = filtered.filter(starts(opts.pathStartsWith))
  if (opts?.pathIncludes) filtered = filtered.filter(incl(opts.pathIncludes))
  return filtered
}

const ADMIN_RAG_INDEX = sanitizeIndexName(process.env.ADMIN_RAG_INDEX_NAME || "admin_endpoints")
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
    } catch {}
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
    try { console.warn("[RAG] ensurePgIndexExists warn:", (e as any)?.message || e) } catch {}
  }
}

function toAbsolute(u: string): string {
  if (!u) return ""
  if (/^https?:\/\//i.test(u)) return u
  const base = process.env.ADMIN_OPENAPI_BASE_URL || process.env.MEDUSA_BACKEND_URL || process.env.URL || ""
  if (!base) return ""
  return `${base.replace(/\/$/, "")}/${u.replace(/^\//, "")}`
}

function buildAuthHeader(): Record<string, string> {
  const headers: Record<string, string> = {}
  const headerOverride = process.env.ADMIN_OPENAPI_CATALOG_HEADER
  const token = process.env.ADMIN_OPENAPI_CATALOG_TOKEN
  if (headerOverride) headers["Authorization"] = headerOverride
  else if (token) {
    const trimmed = String(token).trim()
    const value = /^Basic\s+/i.test(trimmed)
      ? trimmed
      : `Basic ${Buffer.from(`${trimmed}:`).toString("base64")}`
    headers["Authorization"] = value
  }
  return headers
}

async function fetchCatalogJson(): Promise<any> {
  const f = (globalThis as any)?.fetch || fetch
  const rawUrl = process.env.ADMIN_OPENAPI_CATALOG_URL || 
    String(process.env.ADMIN_OPENAPI_CATALOG_SOURCE || "")
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

function extractEndpoints(data: any): Array<{ method: string; path: string; summary?: string; description?: string; params?: Array<{ name: string; in?: string; type?: string }>; request_schema?: string; response_schema?: string }> {
  const out: Array<{ method: string; path: string; summary?: string; description?: string; params?: Array<{ name: string; in?: string; type?: string }>; request_schema?: string; response_schema?: string }> = []
  // Support alternative catalog format with `items: [{ method, path, summary, pathParams, queryParams }]`
  const items = data?.items || data?.data?.items
  if (Array.isArray(items) && items.length) {
    for (const it of items) {
      const method = String(it?.method || "").toUpperCase()
      const rawPath = String(it?.path || "")
      if (!method || !rawPath) continue
      const path = ensureAdminPath(rawPath)
      const params: Array<{ name: string; in?: string; type?: string }> = []
      const qp = Array.isArray(it?.queryParams) ? it.queryParams : []
      const pp = Array.isArray(it?.pathParams) ? it.pathParams : []
      for (const n of qp) params.push({ name: String(n), in: "query" })
      for (const n of pp) params.push({ name: String(n), in: "path" })
      out.push({
        method,
        path,
        summary: it?.summary,
        description: it?.description,
        params,
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
            ? op.parameters.map((pa: any) => ({ name: pa?.name, in: pa?.in, type: pa?.schema?.type })).filter((x: any) => x.name)
            : undefined
          const reqSchema = summarizeSchema(op.requestBody?.content?.["application/json"]?.schema || op.requestBody?.content?.["application/ld+json"]?.schema)
          const respSchema = summarizeSchema(
            op.responses?.["200"]?.content?.["application/json"]?.schema ||
            op.responses?.["201"]?.content?.["application/json"]?.schema ||
            op.responses?.default?.content?.["application/json"]?.schema
          )
          out.push({ method: mm, path: p, summary: op.summary, description: op.description, params, request_schema: reqSchema, response_schema: respSchema })
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

function buildEndpointDoc(ep: { method: string; path: string; summary?: string; description?: string; params?: Array<{ name: string; in?: string; type?: string }>; request_schema?: string; response_schema?: string }) {
  const body = [
    `METHOD: ${ep.method}`,
    `PATH: ${ensureAdminPath(ep.path)}`,
    ep.summary ? `SUMMARY: ${ep.summary}` : "",
    ep.description ? `DESCRIPTION: ${ep.description}` : "",
    ep.params && ep.params.length ? `PARAMS: ${ep.params.slice(0, 8).map((p) => `${p.name}${p.in ? `(${p.in})` : ""}${p.type ? `:${p.type}` : ""}`).join(", ")}` : "",
    ep.request_schema ? `REQUEST: ${ep.request_schema}` : "",
    ep.response_schema ? `RESPONSE: ${ep.response_schema}` : "",
  ].filter(Boolean).join("\n")
  const searchable = `${ep.method} ${ensureAdminPath(ep.path)} ${ep.summary || ""} ${ep.description || ""} ${ep.request_schema || ""} ${ep.response_schema || ""}`
  return { text: body, metadata: { method: ep.method, path: ensureAdminPath(ep.path), summary: ep.summary, description: ep.description, params: ep.params, request_schema: ep.request_schema, response_schema: ep.response_schema, searchable } }
}

export async function ingestAdminCatalog(force = false) {
  if (!force && Date.now() - lastIngestAt < INGEST_TTL_MS) return { status: "cached" }
  const json = await fetchCatalogJson()
  const endpoints = extractEndpoints(json)
  if (!endpoints.length) return { status: "no_endpoints" }

  // Build documents: one per endpoint
  const docs = endpoints.map(buildEndpointDoc)

  // Optionally also chunk full JSON as a single MDocument for structure search
  const jsonDoc = MDocument.fromJSON(JSON.stringify(json))
  // Some chunkers require maxSize; set a sane default and allow override via env
  let jsonChunks: Array<{ text: string }> = []
  try {
    const maxSize = Number(process.env.ADMIN_RAG_JSON_CHUNK_MAX || 6000)
    jsonChunks = await jsonDoc.chunk({ strategy: "json", maxSize })
  } catch (e) {
    // Non-fatal: skip JSON structural chunks if chunker complains
    try { console.warn("[RAG] JSON chunking skipped", (e as any)?.message || e) } catch {}
    jsonChunks = []
  }

  const allTexts: string[] = [
    ...docs.map((d) => d.text),
    ...jsonChunks.map((c) => c.text),
  ]
  const allMetas: any[] = [
    ...docs.map((d) => d.metadata),
    ...jsonChunks.map((_, i) => ({ type: "openapi-json-chunk", idx: i })),
  ]

  const { embeddings } = await embedMany({
    model: openai.embedding("text-embedding-3-small"),
    values: allTexts,
  })

  // Normalize vectors to number[][] defensively
  let vectorsArr: number[][] = []
  try {
    vectorsArr = (embeddings as any[]).map((v) => {
      if (Array.isArray(v)) return v as number[]
      if (v && Array.isArray((v as any).values)) return (v as any).values as number[]
      if (v && Array.isArray((v as any).embedding)) return (v as any).embedding as number[]
      return []
    }).filter((v) => Array.isArray(v) && v.length > 0 && typeof v[0] === "number")
  } catch {}

  // Align metadata length to vectors
  const metasAligned = allMetas.slice(0, vectorsArr.length)
  if (metasAligned.length !== vectorsArr.length) {
    try { console.warn(`[RAG] metas misaligned: ${metasAligned.length} vs vectors ${vectorsArr.length}`) } catch {}
  }

  // If no vectors, skip upsert gracefully
  if (!vectorsArr.length) {
    return { status: "no_vectors", count: 0 }
  }

  // PgVector.upsert expects vectors: number[][] and optional metadata/ids arrays
  const store = getPgVector()
  // Ensure index exists (unconditionally try to create; ignore if already exists)
  const dim = vectorsArr[0]?.length || 1536
  try {
    try {
      await store.createIndex?.({ indexName: ADMIN_RAG_INDEX, dimension: dim, metric: "cosine" })
    } catch (e1) {
      try {
        await store.createIndex?.(ADMIN_RAG_INDEX, dim, "cosine")
      } catch (e2) {
        try { console.warn("[RAG] createIndex failed", (e1 as any)?.message || e1, (e2 as any)?.message || e2) } catch {}
      }
    }
  } catch (e) {
    try { console.warn("[RAG] createIndex outer error", (e as any)?.message || e) } catch {}
  }
  try {
    await store.upsert({
      indexName: ADMIN_RAG_INDEX,
      vectors: vectorsArr,
      metadata: metasAligned,
    })
  } catch (e) {
    try {
      console.error("[RAG] upsert failed", { type0: typeof (vectorsArr[0] as any), isArray0: Array.isArray(vectorsArr[0]) })
    } catch {}
    throw e
  }
  lastIngestAt = Date.now()
  return { status: "ingested", count: vectorsArr.length }
}

export async function queryAdminEndpoints(query: string, method?: string, topK = 5) {
  // Heuristically map NL to an endpoint-like phrase to match our stored 'searchable' strings (e.g., "GET /admin/api-keys")
  const stop = new Set([
    "the","a","an","all","of","to","for","in","on","at","about","me","please","show","list","get","with","and","or","by","from"
  ])
  const lower = String(query || "").toLowerCase()
  const inferredMethod = ((): string | undefined => {
    if (method) return String(method).toUpperCase()
    if (/\b(create|add|make|new)\b/.test(lower)) return "POST"
    if (/\b(update|edit|modify|patch)\b/.test(lower)) return "PATCH"
    if (/\b(put|replace)\b/.test(lower)) return "PUT"
    if (/\b(delete|remove|archive)\b/.test(lower)) return "DELETE"
    return "GET"
  })()
  const keywords = lower
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !stop.has(w))
  const slug = keywords.join("-")
  const guessPath = slug ? `/admin/${slug}`.replace(/--+/g, "-") : "/admin"
  const boosted = `${inferredMethod} ${guessPath}\n${query}`
  try { console.log(`[RAG][query] start`, { index: ADMIN_RAG_INDEX, query: boosted, method: inferredMethod, topK }) } catch {}

  // 1) Try lexical match directly against the catalog as a robust fallback/primary when obvious
  const lexical = await lexicalQueryAdminEndpoints(query, inferredMethod, topK)
  if (Array.isArray(lexical) && lexical.length) {
    try { console.log(`[RAG][query] lexical hit`, { count: lexical.length, first: lexical[0] }) } catch {}
    return lexical
  }
  const { embeddings } = await embedMany({
    model: openai.embedding("text-embedding-3-small"),
    values: [boosted],
  })
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
    try { console.warn(`[RAG][query] vector sanitized`, { dim: queryVector.length, replaced }) } catch {}
  }
  // If still empty or suspicious, skip querying the store to avoid errors
  if (!queryVector.length) {
    try { console.warn(`[RAG][query] skip: empty vector`) } catch {}
    return []
  }
  let store: ReturnType<typeof getPgVector>
  try {
    store = getPgVector()
  } catch (e) {
    try { console.warn(`[RAG][query] getPgVector error`, (e as any)?.message || e) } catch {}
    return []
  }
  try { console.log(`[RAG][query] vector`, { dim: queryVector?.length }) } catch {}
  let results: any[] = []
  try {
    results = await store.query({ indexName: ADMIN_RAG_INDEX, vector: queryVector, topK })
  } catch (e) {
    try { console.warn(`[RAG][query] store.query error`, (e as any)?.message || e) } catch {}
    return []
  }
  try {
    console.log(`[RAG][query] raw results`, {
      count: Array.isArray(results) ? results.length : 0,
      sample: Array.isArray(results) ? results.slice(0, 3).map((r: any) => ({ score: r.score, method: r?.metadata?.method, path: r?.metadata?.path })) : [],
    })
  } catch {}
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
  try { console.log(`[RAG][query] endpoints`, { count: endpoints.length, first: endpoints[0] }) } catch {}
  return endpoints
}

// Simple lexical search over the OpenAPI catalog without embeddings
async function lexicalQueryAdminEndpoints(query: string, method?: string, topK = 5) {
  try { console.log(`[RAG][lex] start`, { topK }) } catch {}
  let json: any
  try {
    json = await fetchCatalogJson()
  } catch (e) {
    try { console.warn(`[RAG][lex] fetch error`, (e as any)?.message || e) } catch {}
    return []
  }
  const endpoints = extractEndpoints(json)
  if (!Array.isArray(endpoints) || !endpoints.length) return []
  const q = String(query || "").toLowerCase()
  const tokens = q.replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean)
  // very light stemming and normalization
  const norm = (t: string) => {
    if (!t) return t
    if (t === "products" || t === "product") return "product"
    if (t.length > 4 && /s$/.test(t)) return t.slice(0, -1) // plural to singular heuristic
    return t
  }
  const stemmed = tokens.map(norm)
  const wantsProduct = stemmed.includes("product")

  function score(ep: any): number {
    let s = 0
    const methodMatch = method ? (String(ep.method).toUpperCase() === String(method).toUpperCase()) : true
    if (!methodMatch) s -= 2
    const pathCanonical = ensureAdminPath(ep.path)
    const hay = `${ep.method} ${pathCanonical} ${ep.summary || ""} ${ep.description || ""} ${ep.request_schema || ""} ${ep.response_schema || ""}`.toLowerCase()
    for (const t of stemmed) {
      if (!t) continue
      if (hay.includes(t)) s += 1
    }
    // Boost if tokens appear in path segments
    const pathOnly = pathCanonical.toLowerCase()
    for (const t of stemmed) {
      if (t.length >= 3 && pathOnly.includes(t)) s += 2 // stronger weight for path matches
    }
    // Small bias for GET listing when query contains list-like words
    if (/\b(list|all|get|show|fetch)\b/.test(q) && ep.method === "GET") s += 1
    // Strong product intent handling
    if (wantsProduct) {
      if (/\/admin\/(products|product)(\b|\/)/.test(pathOnly)) s += 3
      if (pathOnly.includes("/api-keys")) s -= 4
    }
    return s
  }

  const scored = endpoints
    .map((ep) => ({ ep, s: score(ep) }))
    .filter((x) => x.s > 0)
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
  try { console.log(`[RAG][lex] results`, { count: scored.length, first: scored[0] }) } catch {}
  return scored
}
