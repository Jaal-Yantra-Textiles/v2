// @ts-nocheck - Ignore all TypeScript errors in this file
import { createWorkflow, createStep } from "@mastra/core/workflows"
import { z } from "zod"
import { v4 as uuidv4 } from "uuid"
import { generalChatAgent } from "../../agents" // dedicated chat agent
import { ingestAdminCatalog, queryAdminEndpoints, queryAdminEndpointsFiltered } from "../../rag/adminCatalog"
import { CATALOG_CACHE_CONFIG } from "../../config/cache"
import { memory } from "../../memory"
import { ToolCallParser } from "./parsers/toolCallParser"
import { multiStepApiRequestWorkflow } from "../multiStepApiRequest"
import { runStorage } from "../../run-storage"

// Constants
const MAX_TEXT_LENGTH = 900
const MAX_OPERATIONS = 6
const RAG_TOP_K = 6
const RAG_FALLBACK_TOP_K = 5
const MAX_TOOL_LOOPS = 4
const MAX_TOOL_RESULT_CHARS = 1800

export type GeneralChatInput = {
  message: string
  threadId?: string
  resourceId?: string
  context?: Record<string, any>
}

function sanitizeAssistantText(text: string): string {
  try {
    if (!text) return ""
    // Remove fenced json tool-call blocks from the final answer
    return String(text).replace(/```json[\s\S]*?```/g, "").trim()
  } catch {
    return String(text || "")
  }
}

function safeToText(v: any, max = MAX_TEXT_LENGTH): string {
  try {
    if (v == null) return ""
    const s = typeof v === "string" ? v : JSON.stringify(v, null, 2)
    return s.length > max ? s.slice(0, max) + "…" : s
  } catch {
    try {
      const s = String(v)
      return s.length > max ? s.slice(0, max) + "…" : s
    } catch {
      return ""
    }
  }
}

function formatOperationChunks(ops: any[], maxOps = MAX_OPERATIONS): string {
  if (!Array.isArray(ops) || !ops.length) return ""
  const lines: string[] = []
  const slice = ops.slice(0, maxOps)
  for (let i = 0; i < slice.length; i++) {
    const op = slice[i] || {}
    const method = String(op.method || "").toUpperCase()
    const path = String(op.path || "")
    const summary = safeToText(op.summary || op.description || "", 240)

    // Explicitly format query params to guide the agent
    let queryParamsInfo = ""
    if (Array.isArray(op.params)) {
      const qp = op.params.filter((p: any) => p.in === "query").map((p: any) => p.name)
      if (qp.length) {
        queryParamsInfo = `Query Params: ${qp.join(", ")}`
      }
    }

    const req = safeToText(op.request_schema, 900)
    const res = safeToText(op.response_schema, 900)
    const parts = [
      `${i + 1}) ${method} ${path}`,
      summary ? `Summary: ${summary}` : undefined,
      queryParamsInfo || undefined,
      req ? `Request schema: ${req}` : undefined,
      res ? `Response schema: ${res}` : undefined,
    ].filter(Boolean) as string[]
    lines.push(parts.join("\n"))
  }
  return lines.join("\n\n")
}

// Simple dependency planner: for certain endpoints, suggest prerequisite list calls
async function planDependencies(
  method: string,
  path: string,
  body: any,
  apiCtx?: { source?: string; allowedEndpoints?: Array<{ method: string; path: string }>; selectedEndpointId?: string }
): Promise<{ next?: Array<{ method: string; path: string; body?: any; openapi?: { method: string; path: string } }>; secondary?: any; notes?: string[] }> {
  const out: { next?: Array<{ method: string; path: string; body?: any; openapi?: { method: string; path: string } }>; secondary?: any; notes?: string[] } = {}
  const notes: string[] = []
  // Generic, schema-free rules:
  // - For write methods (POST/PATCH/PUT/DELETE), if body contains missing identifier fields (e.g., product_id, collection_id, stock_location_id),
  //   suggest GET list endpoints to help the user pick IDs.

  const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"])
  const m = (method || "").toUpperCase()
  if (!WRITE_METHODS.has(m)) {
    return out
  }

  const allowed = await getAllowedEndpoints(apiCtx)
  if (!Array.isArray(allowed) || !allowed.length) {
    return out
  }

  const isObject = (v: any) => v && typeof v === "object" && !Array.isArray(v)
  const b = isObject(body) ? body : {}

  // Heuristic: scan for keys that end with _id or _ids and are missing/empty
  const keys = Object.keys(b)
  const missingIdKeys: string[] = []
  for (const k of keys) {
    if (/_ids?$/.test(k)) {
      const val = (b as any)[k]
      const isMissing = val === undefined || val === null || (Array.isArray(val) && val.length === 0) || (typeof val === "string" && !val.trim())
      if (isMissing) missingIdKeys.push(k)
    }
  }

  // If there are no *_id keys, we can still try to infer from common patterns depending on the endpoint path later if needed.
  if (!missingIdKeys.length) {
    return out
  }

  const toKebab = (s: string) => s.replace(/_/g, "-")
  const toPlural = (s: string) => {
    if (s.endsWith("y")) return s.slice(0, -1) + "ies"
    if (s.endsWith("s")) return s
    return s + "s"
  }

  // Collect a basic q hint to pass to list endpoints
  const qHintCandidates = ["q", "sku", "title", "handle", "email", "name", "code", "reference"]
  let qHint: string | undefined
  for (const c of qHintCandidates) {
    const v = (b as any)[c]
    if (typeof v === "string" && v.trim()) { qHint = v.trim(); break }
  }

  const next: Array<{ method: string; path: string; body?: any; openapi?: { method: string; path: string } }> = []

  for (const k of missingIdKeys) {
    // Derive resource name by removing trailing _id or _ids
    let base = k.replace(/_ids?$/, "")
    base = toKebab(base)
    const plural = toPlural(base)
    const candidatePath = `/admin/${plural}`
    // Only suggest if allowed contains this GET
    const exists = allowed.find((e) => e.method.toUpperCase() === "GET" && e.path === candidatePath)
    if (exists) {
      const body: any = { limit: 50 }
      if (qHint) body.q = qHint
      next.push({ method: "GET", path: candidatePath, body, openapi: { method: "GET", path: candidatePath } })
      notes.push(`${k} is missing → suggest listing ${plural} to pick one`)
    }
  }

  if (next.length) out.next = next
  if (notes.length) out.notes = notes

  return out
}

// Heuristic alias mapper used only when catalog index is empty
function normalizePathAliases(p: string): { path: string; extractedQ?: string } {
  let path = normalizePath(p)
  let extractedQ: string | undefined
  // inventory → inventory-items
  if (path.startsWith("/admin/inventory")) {
    const segs = path.split("?")[0].split("/").filter(Boolean)
    // Try to extract SKU/title hint as the segment after 'inventory'
    const idx = segs.findIndex((s) => s === "inventory")
    const hint = idx >= 0 && segs[idx + 1] && !segs[idx + 1].includes("-") ? segs[idx + 1] : undefined
    if (hint) extractedQ = decodeURIComponent(hint)
    path = "/admin/inventory-items"
  }
  // products → products (normalize common mistakes)
  if (path.includes("/admin/api/products")) {
    path = path.replace("/admin/api/products", "/admin/products")
  }
  if (path.endsWith("/admin/product")) {
    path = path.replace("/admin/product", "/admin/products")
  }
  if (path.includes("admin-api-products")) {
    path = path.replace("admin-api-products", "products")
  }
  // stock_locations → stock-locations
  if (path.includes("stock_locations")) {
    path = path.replace("stock_locations", "stock-locations")
  }
  // locations → stock-locations (common alias)
  if (path.endsWith("/locations") || path.includes("/locations?")) {
    path = path.replace("/locations", "/stock-locations")
  }
  return { path, extractedQ }
}

function findEndpointsByTerms(allowed: Endpoint[], terms: string[]): Endpoint[] {
  if (!Array.isArray(allowed) || !allowed.length) return []
  const needles = terms.map((t) => t.toLowerCase())
  const scored = allowed.map((e) => {
    const hay = `${e.method} ${e.path}`.toLowerCase()
    let score = 0
    for (const n of needles) if (hay.includes(n)) score++
    return { e, score }
  })
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.e)
    .slice(0, 5)
}

export type GeneralChatOutput = {
  reply: string
  toolCalls?: Array<{ name: string; arguments: Record<string, any> }>
  threadId?: string
  resourceId?: string
  // results of any activations we performed
  activations?: Array<{ name: string; arguments: Record<string, any>; result: any }>
}

// Heuristic summarizer used when the LLM is unavailable
function summarizeDataHeuristic(data: any): string {
  try {
    if (data == null) return "No data to summarize."
    const isArr = Array.isArray(data)
    if (isArr) {
      const n = data.length
      const sample = data.slice(0, 3)
      const keys = sample[0] ? Object.keys(sample[0]).slice(0, 6) : []
      const preview = sample.map((it: any, i: number) => {
        const id = it.id || it._id || it.sku || it.title || it.name || `#${i + 1}`
        return typeof id === "string" ? id : JSON.stringify(it).slice(0, 120)
      })
      return [`Items: ${n}`, keys.length ? `Top keys: ${keys.join(", ")}` : undefined, preview.length ? `Examples: ${preview.join(", ")}` : undefined]
        .filter(Boolean).join("\n")
    }
    if (typeof data === "object") {
      const keys = Object.keys(data)
      const lines: string[] = []
      lines.push(`Object with ${keys.length} keys`)
      const top = keys.slice(0, 8)
      lines.push(`Top keys: ${top.join(", ")}`)
      // Show short previews for list-ish keys if present
      for (const k of top) {
        const v = (data as any)[k]
        if (Array.isArray(v)) {
          lines.push(`${k}: ${v.length} items`)
        }
      }
      return lines.join("\n")
    }
    return String(data)
  } catch {
    return "(unable to summarize data)"
  }
}

async function summarizeApiResult(agent: any, data: any, threadId?: string, resourceId?: string): Promise<string> {
  // Try LLM summarization first; fallback to heuristic if it fails
  const heuristic = summarizeDataHeuristic(data)
  try {
    if (!agent) return heuristic
    const payload = typeof data === "string" ? data : JSON.stringify(data, null, 2)
    const prompt = [
      "Summarize the following API JSON result succinctly for an admin user.",
      "- Mention item counts and important fields.",
      "- If it is a list, show a short bullet list of top 3 items by a meaningful identifier (id, title, name, sku).",
      "- Keep it under 8 lines.",
      "JSON:",
      payload,
    ].join("\n")
    const gen = await agent.generate(prompt, {
      memory: { thread: threadId, resource: resourceId },
    })
    const text = (gen as any)?.text || ""
    return text.trim() || heuristic
  } catch {
    return heuristic
  }
}

// Basic intent detection to synthesize toolCalls if user explicitly asks for an action.
function inferToolCallsFromMessage(message: string): Array<{ name: string; arguments: Record<string, any> }> {
  const text = message.toLowerCase()
  const calls: Array<{ name: string; arguments: Record<string, any> }> = []
  // Let the LLM suggest calls; we only parse explicit METHOD /path patterns the user typed.
  // Generic: detect direct API intents like "POST /admin/xyz" or "get /admin/products"
  const verbPath = message.match(/\b(get|post|put|patch|delete)\s+\/(?:admin|store)\/[\w\-\/{}/:?&=]+/i)
  if (verbPath) {
    const segs = verbPath[0].trim().split(/\s+/)
    if (segs.length >= 2) {
      const method = segs[0].toUpperCase()
      const path = segs.slice(1).join(" ") // in case of spaces
      calls.push({
        name: "admin_api_request",
        arguments: {
          method,
          path,
          openapi: { method, path },
        },
      })
    }
  }

  // Handle XML-style tool calls: <tool_call><function=name>...</function></tool_call>
  // We make the outer <tool_call> optional and just look for the function block to be robust.
  const xmlPattern = /<function=([^>]+)>([\s\S]*?)<\/function>/g
  let match
  while ((match = xmlPattern.exec(message)) !== null) {
    const name = match[1]
    const paramsBlock = match[2]
    const args: Record<string, any> = {}

    const paramPattern = /<parameter=([^>]+)>([\s\S]*?)<\/parameter>/g
    let pMatch
    while ((pMatch = paramPattern.exec(paramsBlock)) !== null) {
      const key = pMatch[1].trim()
      let val = pMatch[2].trim()
      // Try parsing JSON values (for objects/arrays)
      try {
        // Convert single quotes to double quotes for JSON parsing if it looks like JSON
        if ((val.startsWith("{") || val.startsWith("[")) && val.includes("'")) {
          val = val.replace(/'/g, '"')
        }
        args[key] = JSON.parse(val)
      } catch {
        args[key] = val
      }
    }
    calls.push({ name, arguments: args })
  }

  // Handle JSON block tool calls
  try {
    const jsonBlock = message.match(/```json\s*({[\s\S]*?})\s*```/);
    if (jsonBlock) {
      const parsed = JSON.parse(jsonBlock[1]);
      if (parsed.toolCalls) {
        parsed.toolCalls.forEach((tc: any) => {
          calls.push({ name: tc.name, arguments: tc.arguments });
        });
      }
    }
  } catch { }

  return calls
}

function shouldPlanToolCallsFromMessage(message: string): boolean {
  const msg = String(message || "").toLowerCase().trim()
  if (!msg) return false

  if (/\b(get|post|put|patch|delete)\s+\/(?:admin|store)\//i.test(msg)) return true
  if (msg.includes("/admin/") || msg.includes("/store/")) return true

  const compact = msg.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()
  if (/^(hi|hey|hello|yo|sup|hey there|hi there|hello there)$/.test(compact)) return false
  if (/^(how are you|how r you|hru|what s up|whats up|good morning|good afternoon|good evening)$/.test(compact)) return false

  const action = /\b(list|show|get|fetch|find|search|create|add|make|new|update|edit|modify|change|set|patch|delete|remove|archive|cancel|refund|fulfill|ship|mark)\b/.test(compact)
  if (!action) return false
  if (compact.split(" ").length <= 2) return false

  return true
}

// Removed extractDesignName - no longer used after entity extraction step was added

// Dispatcher to "activate" tools. For now, we standardize to return a planned Admin API request
// using official Admin API paths so the UI can infer required inputs from the OpenAPI catalog.
// The UI will execute via sdk.client.fetch.
async function executeTool(name: string, args: Record<string, any>, apiCtx?: {
  source?: string
  allowedEndpoints?: Array<{ method: string; path: string }>
  selectedEndpointId?: string
}) {
  switch (name) {
    case "suggest_admin_endpoints": {
      // args: { query?: string, method?: string }
      const query: string = String(args?.query || "").trim()
      const method: string | undefined = args?.method ? String(args.method).toUpperCase() : undefined
      const allowed = await getAllowedEndpoints(apiCtx)
      const terms = query ? query.split(/\s+/g).slice(0, 6) : []
      let suggestions = terms.length ? findEndpointsByTerms(allowed, terms) : allowed.slice(0, 10)
      if (method) suggestions = suggestions.filter((e) => e.method.toUpperCase() === method)

      // RAG fallback/augment when catalog is empty or weak
      if (!suggestions.length) {
        try {
          const rag = await queryAdminEndpoints(query || "admin api endpoint suggestions", method)
          const mapped = rag.map((r: any) => ({ method: r.method, path: r.path }))
          // de-dup with allowed-based ones
          const key = (e: any) => `${e.method} ${e.path}`
          const seen = new Set(suggestions.map(key))
          for (const m of mapped) { if (!seen.has(key(m))) { suggestions.push(m); seen.add(key(m)) } }
        } catch (e) { try { console.warn("[AI][catalog][RAG] suggest fallback error", (e as any)?.message || e) } catch { } }
      }
      try { console.log("[AI][catalog] suggestions", { query, method, count: suggestions.length }) } catch { }
      return {
        status: "suggestions",
        tool: name,
        args,
        result: suggestions,
      }
    }
    case "admin_api_request": {
      // Generic pass-through; validate against allowedEndpoints if provided
      const method = (args?.openapi?.method || args?.method || "POST").toUpperCase()
      let path = args?.openapi?.path || args?.path || "/admin"

      // Critical cleanup: The LLM frequently plans GET requests with filter params in 'body'.
      // Normalize this by moving body content to query for GET requests.
      if (args?.body && typeof args.body === "object" && method === "GET") {
        args.query = { ...(args.query || {}), ...args.body }
        args.body = undefined
        // Also ensure any tool call args are updated if we need to reflect this back
      }

      // Interpolate path parameters generically from args.path_params/params/body
      try {
        const replacePathParams = (p: string, map: Record<string, any>) => {
          if (!p) return p
          let out = p
          // {param} style
          out = out.replace(/\{([^}]+)\}/g, (_, key) => {
            const v = map?.[key]
            return v != null ? encodeURIComponent(String(v)) : `{${key}}`
          })
          // :param style
          out = out.replace(/:([A-Za-z0-9_]+)/g, (_, key) => {
            const v = map?.[key]
            return v != null ? encodeURIComponent(String(v)) : `:${key}`
          })
          return out
        }
        const candidateMaps: Record<string, any>[] = []
        if (args?.path_params && typeof args.path_params === "object") candidateMaps.push(args.path_params)
        if (args?.params && typeof args.params === "object") candidateMaps.push(args.params)
        if (args?.body && typeof args.body === "object") candidateMaps.push(args.body)
        // Common id fallback mapping
        const idMap: Record<string, any> = {}
        if (args?.id) idMap.id = args.id
        if (args?.entity_id) idMap.id = args.entity_id
        if (Object.keys(idMap).length) candidateMaps.push(idMap)
        for (const m of candidateMaps) {
          path = replacePathParams(path, m)
        }
      } catch { }
      path = normalizePath(path)
      // Resolve allowed endpoints via CatalogIndex
      const index = await getCatalogIndex(apiCtx)
      let isAllowed = index.size === 0 || index.has(method, path)
      // Even if index exists, try alias normalization for common mistakes (inventory/items -> inventory-items)
      if (!isAllowed) {
        const alias = normalizePathAliases(path)
        if (alias.path !== path && index.has(method, alias.path)) {
          try { console.log("[AI][catalog] alias(normalize existing) →", { from: path, to: alias.path, q: alias.extractedQ }) } catch { }
          path = alias.path
          if (method === "GET" && !args?.body && alias.extractedQ) {
            args = { ...args, body: { limit: 50, q: alias.extractedQ } }
          }
          isAllowed = true
        }
      }
      // When catalog/index is empty, apply heuristic alias mapping for common cases
      if (index.size === 0) {
        const alias = normalizePathAliases(path)
        if (alias.path !== path) {
          try { console.log("[AI][catalog] alias(normalize) →", { from: path, to: alias.path, q: alias.extractedQ }) } catch { }
          path = alias.path
          // For GET calls, if no body provided but we extracted a query hint, attach it
          if (method === "GET" && !args?.body && alias.extractedQ) {
            args = { ...args, body: { limit: 50, q: alias.extractedQ } }
          }
        }
        isAllowed = true // allow pass-through when we cannot validate
      }
      if (!isAllowed) {
        // Try a simple path normalization (underscores -> hyphens) as a final alias attempt
        const aliased = index.normalizePath(path)
        if (aliased !== path && index.has(method, aliased)) {
          try { console.log("[AI][catalog] alias match", { from: path, to: aliased }) } catch { }
          path = aliased
          isAllowed = true
        }

        // If still not allowed, try RAG refinement even when index exists
        if (!isAllowed) {
          try {
            const rag = await queryAdminEndpoints(`${method} ${path}`, method)
            if (Array.isArray(rag) && rag.length) {
              // Prefer the first RAG candidate that exists in catalog index
              const preferred = rag.find((c: any) => index.has(method, index.normalizePath(c.path))) || rag[0]
              const corrected = index.normalizePath(preferred.path)

              // Helper to check if correction introduces new parameters
              const hasNewParams = (orig: string, fix: string) => {
                const oParams = (orig.match(/\{[^}]+\}/g) || []).length + (orig.match(/:[a-zA-Z0-9_]+/g) || []).length
                const fParams = (fix.match(/\{[^}]+\}/g) || []).length + (fix.match(/:[a-zA-Z0-9_]+/g) || []).length
                return fParams > oParams
              }

              if (index.has(method, corrected)) {
                // If correction adds params (e.g. /websites -> /websites/{id}/analytics), it's likely a hallucination mismatch. Reject it.
                if (hasNewParams(path, corrected)) {
                  try { console.log("[AI][catalog][RAG] rejected correction (new params)", { from: path, to: corrected }) } catch { }
                  // Allow the original path to pass through, even if not in catalog. It might be a valid endpoint missing from index.
                  isAllowed = true
                }
                // ALSO reject if the correction strips a specific ID segment (e.g. /designs/01... -> /designs)
                // This happens when RAG matches the list endpoint instead of the detail endpoint
                else if (path.split('/').length > corrected.split('/').length) {
                  try { console.log("[AI][catalog][RAG] rejected correction (truncation)", { from: path, to: corrected }) } catch { }
                  isAllowed = true
                }
                else {
                  try { console.log("[AI][catalog][RAG] corrected path", { from: path, to: corrected, method, score: preferred?.score }) } catch { }
                  path = corrected
                  isAllowed = true
                }
              } else {
                try { console.log("[AI][catalog][RAG] candidate not in catalog", { candidate: corrected, method, score: preferred?.score }) } catch { }
                // If we found nothing in catalog, default to allowing the original path. 
                // Better to try 404 than guaranteed wrong endpoint.
                isAllowed = true
              }
            } else {
              try { console.log("[AI][catalog][RAG] no candidates for", { method, path }) } catch { }
            }
          } catch (e) { try { console.warn("[AI][catalog][RAG] refine(existing-index) error", (e as any)?.message || e) } catch { } }
        }
      }

      // If now valid (or index empty), return planned request
      if (!index.size || isAllowed || index.has(method, path)) {
        // Attach dependency plan if applicable
        let dep: any = {}
        try { dep = await planDependencies(method, path, args?.body, apiCtx) } catch { }
        return {
          status: "planned",
          tool: name,
          args,
          request: {
            method,
            path,
            body: args?.body,
            query: args?.query,
            openapi: { method, path },
          },
          ...(dep?.next ? { next: dep.next } : {}),
          ...(dep?.secondary ? { secondary: dep.secondary } : {}),
          ...(dep?.notes ? { notes: dep.notes } : {}),
        }
      }

      // Fallback with suggestions
      const allowed = await getAllowedEndpoints(apiCtx)
      const suggestions = suggestEndpoints(method, path, allowed)
      return {
        status: "invalid_endpoint",
        tool: name,
        args,
        result: {
          message: `Endpoint not in allowed catalog: ${method} ${path}`,
          suggestions,
        },
      }
    }
    default: {
      // Fallback: if args already contains method/path or openapi hints, wrap as planned
      const method = (args?.openapi?.method || args?.method || "").toUpperCase()
      const path = args?.openapi?.path || args?.path
      if (method && path) {
        return {
          status: "planned",
          tool: name,
          args,
          request: { method, path, body: args?.body, query: args?.query, openapi: { method, path } },
        }
      }
      return { status: "unknown_tool", tool: name, args }
    }
  }
}

// Schemas for workflow IO (required for step-based execution/streaming)
const inputSchema = z.object({
  message: z.string(),
  threadId: z.string().optional(),
  resourceId: z.string().optional(),
  context: z.record(z.any()).optional(),
})

const toolCallSchema = z.object({
  name: z.string(),
  arguments: z.record(z.any()),
})

const activationSchema = z.object({
  name: z.string(),
  arguments: z.record(z.any()),
  result: z.any(),
})

const outputSchema = z.object({
  reply: z.string(),
  toolCalls: z.array(toolCallSchema).optional(),
  activations: z.array(activationSchema).optional(),
  threadId: z.string().optional(),
  resourceId: z.string().optional(),
  suspended: z.boolean().optional(),
  suspendPayload: z.any().optional(),
  runId: z.string().optional(),
})

// Step 0: Initialize/prime API catalog cache so later steps can validate quickly
const initApiCatalog = createStep({
  id: "init-api-catalog",
  inputSchema,
  // pass input through unchanged
  outputSchema: inputSchema,
  execute: async ({ inputData }) => {
    try {
      try { console.log("[generalChat] init-api-catalog:start") } catch { }
      const apiCtx = (inputData?.context as any)?.api_context || {}
      // Prime the cache (no-op if already fresh)
      try { await getAllowedEndpoints(apiCtx) } catch (e) { console.warn("[generalChat] getAllowedEndpoints error", (e as any)?.message || e) }
      try { await getCatalogIndex(apiCtx) } catch (e) { console.warn("[generalChat] getCatalogIndex error", (e as any)?.message || e) }
      // Kick off RAG ingestion without blocking the step
      try {
        void ingestAdminCatalog(false).then((res) => {
          try { console.log("[generalChat] RAG ingest (async) done", res) } catch { }
        }).catch((e) => {
          try { console.warn("[generalChat] RAG ingest (async) error", (e as any)?.message || e) } catch { }
        })
      } catch (e) {
        try { console.warn("[generalChat] RAG ingest launch error", (e as any)?.message || e) } catch { }
      }
    } catch (e) {
      // Non-fatal: continue even if catalog fetch fails
      console.warn("[generalChat] init-api-catalog failed", (e as any)?.message || e)
    }
    // pass-through original input to next step
    try { console.log("[generalChat] init-api-catalog:end") } catch { }
    return inputData
  },
})

const entitySchema = z.object({
  intent: z.string().optional(),
  resource: z.string().optional(),
  id: z.string().optional(),
  name: z.string().optional(),
  filters: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
})

const extractionSchema = z.object({
  extracted: entitySchema.optional(),
})

// Union schema for steps content
const augmentedInputSchema = inputSchema.merge(extractionSchema)

const routeSchema = z.object({
  mode: z.enum(["recipe", "hitl", "tool", "rag", "chat"]).default("chat"),
  reason: z.string().optional(),
})

const routedInputSchema = augmentedInputSchema.merge(
  z.object({
    route: routeSchema.optional(),
  })
)

const routeIntent = createStep({
  id: "route-intent",
  inputSchema: augmentedInputSchema,
  outputSchema: routedInputSchema,
  execute: async ({ inputData }) => {
    const rawMsg = String(inputData.message || "")
    const msg = rawMsg.toLowerCase()
    const extracted = (inputData as any)?.extracted
    const allowPlanning = shouldPlanToolCallsFromMessage(rawMsg)

    const isDesignQuery = /\bdesigns?\b/i.test(rawMsg)
    const wantsApproved = isDesignQuery && /\bapproved\b/i.test(rawMsg)
    const wantsRecent = isDesignQuery && /\b(recent|recently|latest|newest)\b/i.test(rawMsg)
    if (wantsApproved || wantsRecent) {
      const out = {
        ...inputData,
        route: { mode: "recipe" as const, reason: wantsApproved ? "designs_approved" : "designs_recent" },
      }
      try { console.log("[generalChat] route-intent", out.route) } catch { }
      return out
    }

    const ordersMentioned = /\borders?\b/i.test(rawMsg) || String(extracted?.resource || "").toLowerCase().includes("order")
    const hasOrdersForName = /\borders?\b\s+(?:for|of)\s+\S+/i.test(rawMsg)
    const productsBoughtPattern = /\bwhat\s+products?\b[\s\S]*\b(bought|purchased)\b/i.test(rawMsg)

    if (ordersMentioned && (hasOrdersForName || productsBoughtPattern)) {
      const out = { ...inputData, route: { mode: "hitl" as const, reason: "orders_by_customer" } }
      try { console.log("[generalChat] route-intent", out.route) } catch { }
      return out
    }

    if (ordersMentioned && allowPlanning) {
      const out = { ...inputData, route: { mode: "tool" as const, reason: "orders_generic" } }
      try { console.log("[generalChat] route-intent", out.route) } catch { }
      return out
    }

    if (allowPlanning) {
      const out = { ...inputData, route: { mode: "tool" as const, reason: "planning_enabled" } }
      try { console.log("[generalChat] route-intent", out.route) } catch { }
      return out
    }

    const out = { ...inputData, route: { mode: "chat" as const, reason: "planning_disabled" } }
    try { console.log("[generalChat] route-intent", out.route) } catch { }
    return out
  },
})

// Step: Extract entities using a focused prompt
const extractEntities = createStep({
  id: "extract-entities",
  inputSchema: augmentedInputSchema,
  outputSchema: augmentedInputSchema,
  execute: async ({ inputData }) => {
    try {
      const msg = String(inputData.message || "").trim()
      if (!msg) return inputData

      // Only extract if it looks like a command
      if (!shouldPlanToolCallsFromMessage(msg)) return inputData

      const prompt = `
      Extract entities from the user message. Return JSON only.
      
      Message: "${msg}"
      
      Output Schema:
      {
        "intent": "list" | "create" | "update" | "delete" | "unknown",
        "resource": "products" | "designs" | "inventory" | etc (singular or plural),
        "id": string (if specific ID mentioned),
        "name": string (if specific name mentioned, e.g. "Summer Collection"),
        "filters": { ...other filters like limit, offset, q }
      }
      
      Rules:
      - If user says "by ID 123", set "id": "123".
      - Look specifically for Medusa IDs (starting with "01...", mixed case alphanumeric). these are ALWAYS IDs.
      - "fetch details", "get details", "show me" suggests intent "get" (if ID present) or "list" (if no ID).
      - If user says "named Summer Collection", set "name": "Summer Collection".
      - Strip conversational fillers ("by the name of", "named", "called").
      - If "name" is found, also add it to "filters.q".
      `

      const gen = await generalChatAgent.generate(prompt, {
        output: entitySchema,
      })
      const extracted = (gen as any)?.object as any
      if (extracted) {
        console.log("[extract-entities] extracted", extracted)
        return { ...inputData, extracted }
      }
    } catch (e) {
      console.warn("[extract-entities] error", (e as any)?.message || e)
    }
    return inputData
  }
})

// Helper to execute API calls server-side (Read-Only Safety enforced in ReAct loop)
async function executeServerSide(
  request: { method: string; path: string; query?: any; body?: any },
  authHeaders?: { authorization?: string; cookie?: string }
) {
  const backendUrl = process.env.MEDUSA_BACKEND_URL || process.env.URL || "http://localhost:9000"

  // Construct URL with query params
  const url = new URL(`${backendUrl}${request.path}`)
  if (request.query) {
    Object.entries(request.query).forEach(([k, v]) => {
      if (v !== undefined && v !== null) {
        url.searchParams.append(k, String(v))
      }
    })
  }

  const method = request.method.toUpperCase()
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }

  if (authHeaders?.authorization) headers["Authorization"] = authHeaders.authorization
  if (authHeaders?.cookie) headers["Cookie"] = authHeaders.cookie

  const init: RequestInit = {
    method,
    headers,
  }

  if (request.body && method !== 'GET' && method !== 'HEAD') {
    init.body = JSON.stringify(request.body)
  }

  try {
    const res = await fetch(url.toString(), init)

    // Parse response
    let data
    const text = await res.text()
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }

    return {
      status: res.status,
      ok: res.ok,
      data,
    }
  } catch (error) {
    return {
      status: 500,
      ok: false,
      error: (error as Error).message
    }
  }
}

// Step: generate reply, parse/infer tool calls, execute tool activations
const chatGenerate = createStep({
  id: "chat-generate",
  inputSchema: routedInputSchema,
  outputSchema,
  execute: async ({ inputData }) => {
    const threadId = inputData.threadId
    const resourceId = inputData.resourceId || "ai:general-chat"
    const apiCtx = (inputData?.context as any)?.api_context || {}
    const allowPlanning = shouldPlanToolCallsFromMessage(inputData.message)
    const contextAuth = (inputData?.context as any)?.auth_headers
    const routedMode = (inputData as any)?.route?.mode as ("recipe" | "hitl" | "tool" | "rag" | "chat" | undefined)
    let mode: "recipe" | "hitl" | "tool" | "rag" | "chat" = routedMode || (allowPlanning ? "tool" : "chat")
    const debug =
      process.env.AI_DEBUG === "true" ||
      process.env.AI_CHAT_DEBUG === "true" ||
      Boolean((inputData?.context as any)?.debug)

    if (debug) {
      try {
        console.log("[generalChat][debug] start", {
          threadId,
          resourceId,
          routedMode,
          mode,
          allowPlanning,
          hasAuth: Boolean(contextAuth?.authorization || contextAuth?.cookie),
          msg: String(inputData.message || "").slice(0, 240),
        })
      } catch { }
    }

    // -------------------------------------------------
    // Recipes (deterministic fast-paths)
    // -------------------------------------------------
    // These bypass LLM tool planning for common, high-value list queries.
    const rawMsg = String(inputData.message || "")
    const msg = rawMsg.toLowerCase()
    const isDesignQuery = /\bdesigns?\b/i.test(rawMsg)
    const wantsApproved = isDesignQuery && /\bapproved\b/i.test(rawMsg)
    const wantsRecent = isDesignQuery && /\b(recent|recently|latest|newest)\b/i.test(rawMsg)
    const extractedResource = String((inputData as any)?.extracted?.resource || "").toLowerCase()
    const isPartnerQuery = /\bpartners?\b/i.test(rawMsg) || extractedResource.includes("partner")
    const wantsPartnerList =
      isPartnerQuery && /\b(list|all|show|get|fetch)\b/i.test(rawMsg) && !/\bfeedbacks?\b/i.test(rawMsg)

    if (mode === "recipe" && (wantsApproved || wantsRecent)) {
      const query: Record<string, any> = {
        limit: 20,
        order: "-created_at",
      }
      if (wantsApproved) {
        // Design status enum includes "Approved" in this project.
        query.status = "Approved"
      }

      const request = {
        method: "GET",
        path: "/admin/designs",
        query,
      }

      const execRes = await executeServerSide(request as any, contextAuth)
      const reply = await summarizeApiResult(generalChatAgent, execRes.data, threadId, resourceId)

      if (debug) {
        try {
          console.log("[generalChat][debug] recipe", {
            request,
            status: execRes?.status,
            ok: execRes?.ok,
          })
        } catch { }
      }

      return {
        reply,
        toolCalls: [],
        activations: [
          {
            name: "admin_api_request",
            arguments: { ...request, openapi: { method: "GET", path: "/admin/designs" } },
            result: {
              status: "executed",
              tool: "admin_api_request",
              request: { ...request, openapi: { method: "GET", path: "/admin/designs" } },
              response: execRes,
            },
          },
        ],
        threadId,
        resourceId,
      }
    }

    // HITL INTEGRATION: use when the request requires disambiguation (e.g. customer name)
    // - analytics/website/domain: multi-step ID resolution
    // - orders of/for <name>: resolve customer, suspend if multiple, then fetch orders via customer_id
    const shouldUseHitl = mode === "hitl"
    if (shouldUseHitl) {
      try {
        const externalRunId = uuidv4()
        const hitlRun = await multiStepApiRequestWorkflow.createRunAsync({
          runId: externalRunId,
        })
        const hitlResult = await hitlRun.start({
          inputData: {
            message: inputData.message,
            threadId,
            context: inputData.context,
          },
        })

        if (debug) {
          try {
            const status = (hitlResult as any)?.status
            const suspended = (hitlResult as any)?.suspended
            const detectOut =
              (hitlResult as any)?.steps?.["detect-multi-step"]?.output ||
              (hitlResult as any)?.steps?.["detect-multi-step"] ||
              undefined
            console.log("[generalChat][debug] hitl", {
              runId: (hitlRun as any)?.runId,
              status,
              suspended: Array.isArray(suspended) ? suspended.map((s: any) => s?.stepId || s) : suspended,
              detectOut,
              stepKeys: Object.keys(((hitlResult as any)?.steps || {}) as any),
            })
          } catch { }
        }

        const detectOut =
          (hitlResult as any)?.steps?.["detect-multi-step"]?.output ||
          (hitlResult as any)?.steps?.["detect-multi-step"] ||
          undefined

        const hitlTraceActivation = {
          name: "hitl_attempt",
          arguments: {},
          result: {
            status: "executed",
            runId: externalRunId,
            detect: detectOut,
            workflowStatus: (hitlResult as any)?.status,
          },
        }
        const needsDisambiguation =
          Boolean((hitlResult as any)?.output?.needsDisambiguation) ||
          Boolean(detectOut?.needsDisambiguation)

        if (debug) {
          try {
            console.log("[generalChat][debug] hitl needsDisambiguation", {
              needsDisambiguation,
              top: (hitlResult as any)?.output?.needsDisambiguation,
              detect: detectOut?.needsDisambiguation,
            })
          } catch { }
        }

        // If HITL workflow detected a multi-step scenario
        if (needsDisambiguation) {
          if ((hitlResult as any).status === "suspended") {
            try {
              runStorage.set(externalRunId, hitlRun)
            } catch { }

            const rawSuspended = (hitlResult as any).suspended?.[0]
            const suspendStepId =
              typeof rawSuspended === "string"
                ? rawSuspended
                : Array.isArray(rawSuspended)
                  ? rawSuspended[0]
                  : (rawSuspended as any)?.stepId

            const suspendPayload = suspendStepId
              ? (hitlResult as any)?.steps?.[suspendStepId]?.suspendPayload
              : null

            if (debug) {
              try {
                console.log("[generalChat][debug] hitl suspended", {
                  rawSuspended,
                  suspendStepId,
                  suspendPayload,
                })
              } catch { }
            }

            return {
              reply: suspendPayload?.reason || "Please select an option:",
              toolCalls: [],
              activations: [hitlTraceActivation],
              threadId,
              resourceId,
              suspended: true,
              suspendPayload,
              runId: externalRunId,
            }
          }

          const finalOut =
            (hitlResult as any)?.steps?.["execute-final-api"]?.output ||
            (hitlResult as any)?.output ||
            (hitlResult as any)?.result

          const result = (finalOut as any)?.result
          const meta = (finalOut as any)?.meta
          const hitlError = (finalOut as any)?.error

          if (debug) {
            try {
              console.log("[generalChat][debug] hitl final", {
                hasResult: Boolean(result),
                resultKeys: result && typeof result === "object" ? Object.keys(result) : undefined,
                meta,
              })
            } catch { }
          }

          if (!result) {
            const selectedLabel = meta?.selectedDisplay || meta?.selectedId
            const identifier = detectOut?.identifier
            const reply = hitlError
              ? (identifier
                  ? `No customers found matching "${identifier}".`
                  : `Unable to complete the request: ${String(hitlError)}`)
              : (selectedLabel
                  ? `No orders found for ${selectedLabel}.`
                  : "No data found.")

            return {
              reply,
              toolCalls: [],
              activations: [hitlTraceActivation, { name: "multi_step_result", arguments: {}, result: { data: undefined, meta, error: hitlError } }],
              threadId,
              resourceId,
            }
          }

          if (result) {
            const dataToSummarize = result

            const wantsProductsBought = /\bwhat\s+products?\b[\s\S]*\b(bought|purchased)\b/i.test(String(inputData.message || ""))

            // If the final API returned an empty list, provide a more specific message.
            // Common Medusa list shape: { <resource>: [], count: 0, ... }
            const maybeCount = (dataToSummarize as any)?.count
            const maybeOrders = (dataToSummarize as any)?.orders
            const isEmptyList =
              (typeof maybeCount === "number" && maybeCount === 0) ||
              (Array.isArray(maybeOrders) && maybeOrders.length === 0)

            const selectedLabel =
              meta?.selectedDisplay || meta?.selectedId

            const activations: any[] = [
              hitlTraceActivation,
              { name: "multi_step_result", arguments: {}, result: { data: dataToSummarize, meta } },
            ]

            try {
              const targetEndpoint = String(meta?.targetEndpoint || "")
              const targetMethod = String(meta?.targetMethod || "GET").toUpperCase()
              const selectedId = String(meta?.selectedId || "")
              const linkQueryKey = meta?.linkQueryKey ? String(meta.linkQueryKey) : undefined
              if (targetEndpoint && targetMethod) {
                const path = targetEndpoint.includes("{id}") && selectedId
                  ? targetEndpoint.replace("{id}", selectedId)
                  : targetEndpoint
                const query = linkQueryKey && selectedId ? { [linkQueryKey]: selectedId } : undefined
                const request = { method: targetMethod, path, query }
                activations.unshift({
                  name: "admin_api_request",
                  arguments: { ...request, openapi: { method: targetMethod, path: targetEndpoint } },
                  result: {
                    status: "executed",
                    tool: "admin_api_request",
                    request: { ...request, openapi: { method: targetMethod, path: targetEndpoint } },
                    response: { status: 200, ok: true, data: dataToSummarize },
                  },
                })
              }
            } catch { }

            if (!isEmptyList && wantsProductsBought && Array.isArray(maybeOrders) && maybeOrders.length) {
              const productCounts = new Map<string, number>()
              const orderIds = maybeOrders
                .map((o: any) => String(o?.id || "").trim())
                .filter(Boolean)
                .slice(0, 5)

              for (const orderId of orderIds) {
                const request = { method: "GET", path: `/admin/orders/${orderId}` }
                const execRes = await executeServerSide(request as any, contextAuth)
                activations.push({
                  name: "admin_api_request",
                  arguments: { ...request, openapi: { method: "GET", path: "/admin/orders/{id}" } },
                  result: { status: "executed", tool: "admin_api_request", request, response: execRes },
                })

                const orderObj = (execRes as any)?.data?.order || (execRes as any)?.data
                const items =
                  (orderObj as any)?.items ||
                  (orderObj as any)?.line_items ||
                  (orderObj as any)?.lineItems ||
                  []

                if (Array.isArray(items)) {
                  for (const it of items.slice(0, 50)) {
                    const title =
                      String(
                        it?.title ||
                        it?.product_title ||
                        it?.variant_title ||
                        it?.variant?.title ||
                        it?.product?.title ||
                        ""
                      ).trim()
                    if (!title) continue
                    const qty = Number(it?.quantity ?? it?.qty ?? 1) || 1
                    productCounts.set(title, (productCounts.get(title) || 0) + qty)
                  }
                }
              }

              const top = Array.from(productCounts.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 20)
                .map(([t, q]) => `${t} (x${q})`)

              const reply = selectedLabel
                ? `Products purchased by ${selectedLabel}:\n${top.length ? top.join("\n") : "No line items found in fetched orders."}`
                : `Products purchased:\n${top.length ? top.join("\n") : "No line items found in fetched orders."}`

              return {
                reply,
                toolCalls: [],
                activations,
                threadId,
                resourceId,
              }
            }

            const reply = (isEmptyList && selectedLabel)
              ? `No orders found for ${selectedLabel}.`
              : await summarizeApiResult(
                  generalChatAgent,
                  dataToSummarize,
                  threadId,
                  resourceId
                )

            return {
              reply,
              toolCalls: [],
              activations,
              threadId,
              resourceId,
            }
          }
        }
      } catch (e) {
        try { console.log("[generalChat] HITL check skipped or failed:", (e as any)?.message) } catch { }
        if (debug) {
          try { console.log("[generalChat][debug] hitl error", { message: (e as any)?.message || e }) } catch { }
        }
        // If HITL fails, fall back to tool mode when planning is allowed.
        mode = allowPlanning ? "tool" : "chat"
      }
    }

    if (mode === "chat") {
      const gen = await generalChatAgent.generate([
        { role: "system", content: "You are a helpful assistant for a textile commerce admin." },
        { role: "user", content: String(inputData.message || "") },
      ], {
        memory: { thread: threadId, resource: resourceId },
      })
      const text = (gen as any)?.text || ""

      if (debug) {
        try { console.log("[generalChat][debug] chat gen", { text: String(text).slice(0, 800) }) } catch { }
      }
      return {
        reply: sanitizeAssistantText(text),
        toolCalls: [],
        activations: [],
        threadId,
        resourceId,
      }
    }

    // Retrieve system instructions
    let opsBlock = ""
    if (allowPlanning && mode !== "chat") {
      try {
        const msg = String(inputData.message || "").trim()
        // Safely access memory with fallback
        const ops = await queryAdminEndpoints(msg, undefined, RAG_TOP_K, { threadId, memory })
        const rendered = formatOperationChunks(ops, MAX_OPERATIONS)
        if (debug) {
          try {
            console.log("[generalChat][debug] rag ops", {
              count: Array.isArray(ops) ? ops.length : 0,
              hasRendered: Boolean(rendered),
            })
          } catch { }
        }
        if (rendered) {
          opsBlock = [
            "Available operations (choose only from these):",
            rendered,
            "Rules:",
            "- Use ONLY method/path pairs from the list above.",
            "- Always use canonical /admin/... paths (never /api/...).",
          ].join("\n")
        }
      } catch (e) { }
    }

    // Simplified System Prompt
    const systemPrompt = [
      "You are a general-purpose AI assistant for a textile commerce platform.",
      "You have access to the following Admin API operations (RAG Context):",
      opsBlock || "No specific API operations found.",
      "",
      "Rules:",
      "1. Answer the user's question directly.",
      "2. If the user asks for data retrieval, you may call tools to fetch the data.",
      "3. You can call tools multiple times (multi-step), using earlier tool results to decide the next call.",
      "4. Only use read-only requests (GET) unless the user explicitly asks to create/update/delete.",
      "5. For GET requests, put query params in 'query' (not in 'body').",
      "6. If you need the user to disambiguate (e.g. multiple customers named Sarah), ask a short follow-up question.",
      "",
      "Examples:",
      "- User: 'List me all orders of Sarah and what products she bought'",
      "  Step 1: Call GET /admin/customers?q=Sarah (find the right customer)",
      "  Step 2: If multiple customers match, ask the user which one.",
      "  Step 3: Call GET /admin/orders?customer_id=<customer_id> (fetch orders)",
      "  Step 4: From the order JSON, extract line items and summarize products purchased.",
      "",
      "Tool call format (return ONLY this JSON block when calling tools):",
      "```json\n{\"toolCalls\":[{\"name\":\"admin_api_request\",\"arguments\":{\"method\":\"GET\",\"path\":\"/admin/orders\",\"query\":{\"limit\":20}}}]}\n```",
      "",
      "",
      inputData.extracted ? `Context: ${JSON.stringify(inputData.extracted)}` : undefined,
    ].filter(Boolean).join("\n")

    const parser = new ToolCallParser()
    const convo: Array<{ role: string; content: string }> = [
      { role: "system", content: systemPrompt },
      { role: "user", content: String(inputData.message || "") },
    ]

    const activations: any[] = []

    if (mode !== "tool") {
      const gen = await generalChatAgent.generate(convo, {
        memory: { thread: threadId, resource: resourceId },
      })
      const rawText = (gen as any)?.text || ""

      if (debug) {
        try {
          console.log("[generalChat][debug] non-tool gen", {
            mode,
            text: String(rawText).slice(0, 1200),
          })
        } catch { }
      }
      return {
        reply: sanitizeAssistantText(rawText),
        toolCalls: [],
        activations,
        threadId,
        resourceId,
      }
    }

    // Tool-execution loop (server-side, GET-only)
    for (let i = 0; i < MAX_TOOL_LOOPS; i++) {
      const gen = await generalChatAgent.generate(convo, {
        memory: { thread: threadId, resource: resourceId },
      })
      const rawText = (gen as any)?.text || ""

      if (debug) {
        try { console.log("[generalChat][debug] tool-loop gen", { i, text: String(rawText).slice(0, 1200) }) } catch { }
      }

      const parsedCalls = parser.parse(rawText)
      const toolCalls = parsedCalls?.length ? parsedCalls : inferToolCallsFromMessage(rawText)

      if (debug) {
        try {
          console.log("[generalChat][debug] tool-loop parsed", {
            i,
            parsedCount: parsedCalls?.length || 0,
            inferredCount: toolCalls?.length || 0,
            first: toolCalls?.[0],
          })
        } catch { }
      }

      if (!toolCalls.length) {
        return {
          reply: sanitizeAssistantText(rawText),
          toolCalls: [],
          activations,
          threadId,
          resourceId,
        }
      }

      // Execute tool calls sequentially. Only auto-execute GET admin_api_request.
      let executedAny = false
      for (const tc of toolCalls) {
        const name = String((tc as any)?.name || "")
        const args = ((tc as any)?.arguments || {}) as Record<string, any>
        const activation = await executeTool(name, args, apiCtx)

        // If it's a planned GET request, execute server-side with the current admin auth context.
        if (
          name === "admin_api_request" &&
          activation?.status === "planned" &&
          String(activation?.request?.method || "").toUpperCase() === "GET"
        ) {
          const request = activation.request

          if (debug) {
            try { console.log("[generalChat][debug] exec", { i, request }) } catch { }
          }
          const execRes = await executeServerSide(
            {
              method: request.method,
              path: request.path,
              query: request.query,
              body: request.body,
            },
            contextAuth
          )

          if (debug) {
            try { console.log("[generalChat][debug] exec result", { i, status: execRes?.status, ok: execRes?.ok }) } catch { }
          }

          const executed = {
            ...activation,
            status: "executed",
            response: execRes,
          }

          activations.push({ name, arguments: args, result: executed })
          executedAny = true

          const toolText = [
            `Tool result: ${request.method} ${request.path}`,
            `Status: ${execRes.status}`,
            `JSON: ${safeToText(execRes.data, MAX_TOOL_RESULT_CHARS)}`,
          ].join("\n")
          convo.push({ role: "assistant", content: toolText })
        } else {
          // Not executed; still return as an activation for UI visibility
          activations.push({ name, arguments: args, result: activation })
        }
      }

      if (!executedAny) {
        // We got tool calls but didn't execute (non-GET or unknown). Return the assistant text as-is.
        return {
          reply: sanitizeAssistantText(rawText),
          toolCalls,
          activations,
          threadId,
          resourceId,
        }
      }

      // After executing tools, ask the agent for the final answer in next loop iteration
      convo.push({
        role: "user",
        content: "Using the tool results above, answer the user's original question. If you need more data, call admin_api_request again."
      })
    }

    // Fallback if we hit loop limit
    const finalGen = await generalChatAgent.generate(convo, {
      memory: { thread: threadId, resource: resourceId },
    })
    const finalText = (finalGen as any)?.text || ""

    return {
      reply: sanitizeAssistantText(finalText),
      toolCalls: [],
      activations,
      threadId,
      resourceId,
    }
  },
})

export const generalChatWorkflow = createWorkflow({
  id: "generalChatWorkflow",
  inputSchema,
  outputSchema,
})
  .then(initApiCatalog)
  .then(extractEntities)
  .then(routeIntent)
  .then(chatGenerate)
  .commit()

// Streaming is handled via WorkflowRun.streamVNext() from the route using createRunAsync().

// ===== Catalog utilities (server-side, lazy, cached) =====
type Endpoint = { method: string; path: string }
let catalogCache: { ts: number; items: Endpoint[] } | null = null
const CATALOG_TTL_MS = CATALOG_CACHE_CONFIG.TTL_MS

async function getAllowedEndpoints(apiCtx?: { source?: string; allowedEndpoints?: Endpoint[] }): Promise<Endpoint[]> {
  // 1) If caller already provided small allowlist, use it
  const provided = apiCtx?.allowedEndpoints
  if (provided && provided.length) {
    try { console.log("[AI][catalog] using provided allowlist", { count: provided.length }) } catch { }
    return normalizeEndpoints(provided)
  }

  // Cache first
  if (catalogCache && Date.now() - catalogCache.ts < CATALOG_TTL_MS) {
    try { console.log("[AI][catalog] cache hit", { ttlMs: CATALOG_TTL_MS, count: catalogCache.items.length }) } catch { }
    return catalogCache.items
  }

  const f = (globalThis as any)?.fetch || fetch
  const headers: Record<string, string> = {}
  const headerOverride = process.env.ADMIN_OPENAPI_CATALOG_HEADER
  const token = process.env.ADMIN_OPENAPI_CATALOG_TOKEN
  if (headerOverride) {
    headers["Authorization"] = headerOverride
    try { console.log("[AI][catalog] auth header: override") } catch { }
  } else if (token) {
    // Accept either already prefixed or raw token per docs (Basic base64("<token>:")).
    const trimmed = String(token).trim()
    if (/^(Bearer|Basic)\s+/i.test(trimmed)) {
      headers["Authorization"] = trimmed
      try { console.log("[AI][catalog] auth header: provided") } catch { }
    } else {
      const basic = `Basic ${Buffer.from(`${trimmed}:`).toString("base64")}`
      headers["Authorization"] = basic
      try { console.log("[AI][catalog] auth header: built Basic from token") } catch { }
    }
  }

  // Resolve URL (allow env or apiCtx). Ensure absolute URL when provided path is relative.
  const rawUrl =
    String(process.env.ADMIN_OPENAPI_CATALOG_URL || "").trim() ||
    (isProbablyUrl(apiCtx?.source)
      ? String(apiCtx?.source)
      : String(apiCtx?.source || "")) ||
    "/admin/ai/openapi/catalog"
  function toAbsolute(u: string): string {
    const uu = String(u || "").trim()
    if (!uu) return ""
    if (/^https?:\/\//i.test(uu)) return uu
    // relative path → prefix with base
    const base = process.env.ADMIN_OPENAPI_BASE_URL || process.env.MEDUSA_BACKEND_URL || process.env.URL || ""
    if (!base) return ""
    return `${base.replace(/\/$/, "")}/${uu.replace(/^\//, "")}`
  }
  // Bypass fetch in test environment to avoid port issues
  if (process.env.NODE_ENV === "test" || process.env.MASTRA_BYPASS === "true") {
    return [{ method: "GET", path: "/admin/products" }]
  }

  const url = toAbsolute(rawUrl)
  if (!url) {
    try { console.warn("[AI][catalog] no valid catalog URL", { rawUrl, env: { ADMIN_OPENAPI_CATALOG_URL: Boolean(process.env.ADMIN_OPENAPI_CATALOG_URL), ADMIN_OPENAPI_BASE_URL: Boolean(process.env.ADMIN_OPENAPI_BASE_URL), MEDUSA_BACKEND_URL: Boolean(process.env.MEDUSA_BACKEND_URL), URL: Boolean(process.env.URL) } }) } catch { }
    return []
  }
  try {
    try { console.log("[AI][catalog] fetching", { url, withAuth: Boolean(token) }) } catch { }
    const r = await f(url, { headers })
    try { console.log("[AI][catalog] response", { status: r.status }) } catch { }
    if (!r.ok) {
      try { console.warn("[AI][catalog] non-OK status", { status: r.status }) } catch { }
      return []
    }
    const data = await r.json()
    // Expect either an array of endpoints or a full spec with paths
    const items = extractEndpointsFromCatalog(data)
    if (!items.length) {
      try { console.warn("[AI][catalog] zero endpoints from catalog; top-level keys", Object.keys(data || {})) } catch { }
    }
    catalogCache = { ts: Date.now(), items }
    try { console.log("[AI][catalog] loaded", { count: items.length }) } catch { }
    return items
  } catch {
    try { console.error("[AI][catalog] fetch error") } catch { }
    return []
  }
}

function isProbablyUrl(s?: string) {
  if (!s) return false
  return /^https?:\/\//i.test(s)
}

function extractEndpointsFromCatalog(data: any): Endpoint[] {
  // If already list of { method, path }
  if (Array.isArray(data) && data.length && data[0]?.method && data[0]?.path) {
    try { console.log("[AI][catalog] parse: root array endpoints", { count: data.length }) } catch { }
    return normalizeEndpoints(data as Endpoint[])
  }

  // Common wrappers
  const candidates = [
    data?.endpoints,
    data?.routes,
    data?.items,
    data?.data?.endpoints,
    data?.data?.routes,
    data?.data?.items,
  ].find((arr) => Array.isArray(arr) && arr.length && arr[0] && (arr[0].method || arr[0].verb) && (arr[0].path || arr[0].url))
  if (candidates) {
    const mapped = (candidates as any[]).map((e) => ({ method: String(e.method || e.verb || "").toUpperCase(), path: String(e.path || e.url || "") }))
    try { console.log("[AI][catalog] parse: array wrapper endpoints", { count: mapped.length }) } catch { }
    return normalizeEndpoints(mapped)
  }

  // OpenAPI-like roots
  const paths =
    data?.paths ||
    data?.spec?.paths ||
    data?.openapi?.paths ||
    data?.swagger?.paths ||
    data?.data?.paths ||
    data?.data?.spec?.paths ||
    data?.data?.openapi?.paths

  const items: Endpoint[] = []
  if (paths && typeof paths === "object") {
    for (const p of Object.keys(paths)) {
      const methodsObj = paths[p] || {}
      for (const m of Object.keys(methodsObj)) {
        const mm = m.toUpperCase()
        if (["GET", "POST", "PUT", "PATCH", "DELETE"].includes(mm)) {
          items.push({ method: mm, path: p })
        }
      }
    }
    try { console.log("[AI][catalog] parse: openapi paths", { count: items.length }) } catch { }
  }
  return normalizeEndpoints(items)
}

function normalizeEndpoints(list: Endpoint[]): Endpoint[] {
  return list.map((e) => ({ method: String(e.method || "").toUpperCase(), path: ensureAdminPath(String(e.path || "")) }))
}

function ensureAdminPath(path: string) {
  if (!path.startsWith("/")) path = `/${path}`
  if (!path.startsWith("/admin")) path = `/admin${path}`.replace("/admin/admin/", "/admin/")
  return path
}

function suggestEndpoints(method: string, path: string, allowed: Endpoint[]): Endpoint[] {
  const m = method.toUpperCase()
  const keySegs = path.split("/").filter(Boolean)
  const last = keySegs[keySegs.length - 1] || ""
  // Simple suggestion: same method and either contains last segment or shares first two segments
  const first2 = keySegs.slice(0, 2).join("/")
  const suggestions = allowed.filter((e) => {
    if (e.method.toUpperCase() !== m) return false
    const segs = e.path.split("/").filter(Boolean)
    const lastE = segs[segs.length - 1] || ""
    const first2E = segs.slice(0, 2).join("/")
    return e.path.includes(last) || first2E === first2
  })
  return suggestions.slice(0, 5)
}

// ===== CatalogIndex (deterministic index + normalization) =====
type CatalogIndex = {
  size: number
  has: (method: string, path: string) => boolean
  normalizePath: (path: string) => string
}

let catalogIndexCache: { ts: number; index: CatalogIndex } | null = null

function normalizePath(path: string): string {
  let p = String(path || "")
  if (!p.startsWith("/")) p = `/${p}`
  if (!p.startsWith("/admin")) p = `/admin${p}`.replace("/admin/admin/", "/admin/")
  // replace underscores with hyphens
  p = p.replace(/_/g, "-")
  return p
}

async function getCatalogIndex(apiCtx?: { source?: string; allowedEndpoints?: Endpoint[] }): Promise<CatalogIndex> {
  // Cache hit
  if (catalogIndexCache && Date.now() - catalogIndexCache.ts < CATALOG_TTL_MS) {
    try { console.log("[AI][catalog] index cache hit") } catch { }
    return catalogIndexCache.index
  }

  // Build from allowed endpoints
  const allowed = await getAllowedEndpoints(apiCtx)
  const map = new Map<string, true>()
  for (const ep of allowed) {
    const key = `${String(ep.method || "").toUpperCase()} ${normalizePath(ep.path || "")}`
    map.set(key, true)
    // Also index a basic alias with underscores (in case catalog delivered hyphens only)
    const underscoreAlias = key.replace(/-/g, "_")
    map.set(underscoreAlias, true)
  }

  const index: CatalogIndex = {
    size: map.size,
    has: (method: string, path: string) => map.has(`${String(method || "").toUpperCase()} ${normalizePath(path)}`),
    normalizePath,
  }

  catalogIndexCache = { ts: Date.now(), index }
  try { console.log("[AI][catalog] index built", { size: index.size }) } catch { }
  return index
}
