// @ts-nocheck - Ignore all TypeScript errors in this file
import { createWorkflow, createStep } from "@mastra/core/workflows"
import { z } from "zod/v4"
import { generalChatAgent } from "../../agents" // dedicated chat agent
import { ingestAdminCatalog, queryAdminEndpoints, queryAdminEndpointsFiltered } from "../../rag/adminCatalog"

export type GeneralChatInput = {
  message: string
  threadId?: string
  resourceId?: string
  context?: Record<string, any>
}

// Simple dependency planner: for certain endpoints, suggest prerequisite list calls
async function planDependencies(
  method: string,
  path: string,
  body: any,
  apiCtx?: { source?: string; allowedEndpoints?: Array<{ method: string; path: string }>; selectedEndpointId?: string }
): Promise<{ next?: Array<{ method: string; path: string; body?: any; openapi?: { method: string; path: string } }>; secondary?: any; notes?: string[] }>
{
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
        } catch (e) { try { console.warn("[AI][catalog][RAG] suggest fallback error", (e as any)?.message || e) } catch {} }
      }
      try { console.log("[AI][catalog] suggestions", { query, method, count: suggestions.length }) } catch {}
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
      } catch {}
      path = normalizePath(path)
      // Resolve allowed endpoints via CatalogIndex
      const index = await getCatalogIndex(apiCtx)
      let isAllowed = index.size === 0 || index.has(method, path)
      // Even if index exists, try alias normalization for common mistakes (inventory/items -> inventory-items)
      if (!isAllowed) {
        const alias = normalizePathAliases(path)
        if (alias.path !== path && index.has(method, alias.path)) {
          try { console.log("[AI][catalog] alias(normalize existing) →", { from: path, to: alias.path, q: alias.extractedQ }) } catch {}
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
          try { console.log("[AI][catalog] alias(normalize) →", { from: path, to: alias.path, q: alias.extractedQ }) } catch {}
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
          try { console.log("[AI][catalog] alias match", { from: path, to: aliased }) } catch {}
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
              if (index.has(method, corrected)) {
                try { console.log("[AI][catalog][RAG] corrected path", { from: path, to: corrected, method, score: preferred?.score }) } catch {}
                path = corrected
                isAllowed = true
              } else {
                try { console.log("[AI][catalog][RAG] candidate not in catalog", { candidate: corrected, method, score: preferred?.score }) } catch {}
              }
            } else {
              try { console.log("[AI][catalog][RAG] no candidates for", { method, path }) } catch {}
            }
          } catch (e) { try { console.warn("[AI][catalog][RAG] refine(existing-index) error", (e as any)?.message || e) } catch {} }
        }
      }

      // If now valid (or index empty), return planned request
      if (!index.size || isAllowed || index.has(method, path)) {
        // Attach dependency plan if applicable
        let dep: any = {}
        try { dep = await planDependencies(method, path, args?.body, apiCtx) } catch {}
        return {
          status: "planned",
          tool: name,
          args,
          request: {
            method,
            path,
            body: args?.body,
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
          request: { method, path, body: args?.body, openapi: { method, path } },
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
})

// Step 0: Initialize/prime API catalog cache so later steps can validate quickly
const initApiCatalog = createStep({
  id: "init-api-catalog",
  inputSchema,
  // pass input through unchanged
  outputSchema: inputSchema,
  execute: async ({ inputData }) => {
    try {
      try { console.log("[generalChat] init-api-catalog:start") } catch {}
      const apiCtx = (inputData?.context as any)?.api_context || {}
      // Prime the cache (no-op if already fresh)
      try { await getAllowedEndpoints(apiCtx) } catch (e) { console.warn("[generalChat] getAllowedEndpoints error", (e as any)?.message || e) }
      try { await getCatalogIndex(apiCtx) } catch (e) { console.warn("[generalChat] getCatalogIndex error", (e as any)?.message || e) }
      // Kick off RAG ingestion without blocking the step
      try {
        void ingestAdminCatalog(false).then((res) => {
          try { console.log("[generalChat] RAG ingest (async) done", res) } catch {}
        }).catch((e) => {
          try { console.warn("[generalChat] RAG ingest (async) error", (e as any)?.message || e) } catch {}
        })
      } catch (e) {
        try { console.warn("[generalChat] RAG ingest launch error", (e as any)?.message || e) } catch {}
      }
    } catch (e) {
      // Non-fatal: continue even if catalog fetch fails
      console.warn("[generalChat] init-api-catalog failed", (e as any)?.message || e)
    }
    // pass-through original input to next step
    try { console.log("[generalChat] init-api-catalog:end") } catch {}
    return inputData
  },
})

// Step: generate reply, parse/infer tool calls, execute tool activations
const chatGenerate = createStep({
  id: "chat-generate",
  inputSchema,
  outputSchema,
  execute: async ({ inputData, mastra }) => {
    const threadId = inputData.threadId
    const resourceId = inputData.resourceId || "ai:general-chat"

    const apiCtx = (inputData?.context as any)?.api_context || {}
    // If the UI has executed an API request and provided JSON back, summarize it.
    let executedSummary: string | undefined
    const executed = apiCtx?.executed_response ?? apiCtx?.response ?? apiCtx?.data
    if (executed !== undefined) {
      try {
        executedSummary = await summarizeApiResult(generalChatAgent, executed, threadId, resourceId)
        try { console.log("[generalChat] executed summary generated") } catch {}
      } catch (e) {
        try { console.warn("[generalChat] executed summary error", (e as any)?.message || e) } catch {}
        executedSummary = summarizeDataHeuristic(executed)
      }
    }
    const system = [
      "You are a general-purpose AI assistant for a textile commerce platform.",
      "Maintain short, precise answers.",
      "If the user asks to take an action, propose an appropriate admin_api_request instead of claiming the action was done.",
      "Respond with normal text, and if tools are proposed, also include a JSON block with an array under key toolCalls: [{ name, arguments }].",
      "Tools and expected argument schemas:",
      "- admin_api_request: { method: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE', path: string, body?: any }",
      "- suggest_admin_endpoints: { query?: string, method?: string }",
      "Prefer GET for listing entities, POST for creation, PATCH for partial updates, PUT for full updates, DELETE for removal.",
      "For admin_api_request, use canonical paths like /admin/products, /admin/inventory-items, etc. If unsure, suggest_admin_endpoints first.",
    ].join("\n")

    // Use the dedicated chat agent and ensure memory context is passed so threads are persisted
    let text = ""
    let newThreadId: string | undefined
    try {
      const precomputed = (apiCtx as any)?.precomputed_reply
      if (typeof precomputed === "string" && precomputed.trim()) {
        text = precomputed
        newThreadId = threadId
      } else {
        const prompt = `${system}\n\nUser: ${String(inputData.message || "")}`
        const runtimeAgent = generalChatAgent
        console.log("runtimeAgent", runtimeAgent)
        const gen = await runtimeAgent.generate(prompt, {
          memory: {
            // If threadId is provided, continue it; otherwise the agent will create one
            thread: threadId,
            resource: resourceId,
          },
        })
        console.log("gen", gen)
        text = (gen as any)?.text || ""
        newThreadId = (gen as any)?.threadId
        // If the model returned nothing, leave text empty; do not echo the user input
      }
    } catch (err) {
      // Fallback: keep empty to avoid echoing user input
      console.error("generalChat chat-generate error", (err as any)?.message || err)
      text = ""
    }

    const allowPlanning = shouldPlanToolCallsFromMessage(inputData.message)

    // Step 1: Parse toolCalls from model output (JSON block or fenced)
    let toolCalls: Array<{ name: string; arguments: Record<string, any> }> = []
    let toolCallsFromModel = false
    let toolCallsFromUser = false
    try {
      // 1) Try fenced ```json blocks
      const fenceMatch = text.match(/```json[\s\S]*?```/)
      const jsonStr = fenceMatch ? fenceMatch[0].replace(/```json|```/g, "").trim() : undefined
      if (jsonStr) {
        const parsed = JSON.parse(jsonStr)
        if (parsed && Array.isArray(parsed.toolCalls)) {
          toolCalls = parsed.toolCalls
          toolCallsFromModel = toolCalls.length > 0
        }
      }

      // 2) Try plain JSON if entire text is JSON
      if (!toolCalls.length) {
        try {
          const parsedText = JSON.parse(text)
          if (parsedText && Array.isArray(parsedText.toolCalls)) {
            toolCalls = parsedText.toolCalls
            toolCallsFromModel = toolCalls.length > 0
          }
        } catch {}
      }

      // 3) Try loose 'json\n{ ... }' pattern (no fences)
      if (!toolCalls.length) {
        const idx = text.indexOf("{")
        if (idx !== -1) {
          const possible = text.slice(idx)
          // Heuristic: grab until last closing brace
          const last = possible.lastIndexOf("}")
          const objStr = last !== -1 ? possible.slice(0, last + 1) : possible
          try {
            const parsedLoose = JSON.parse(objStr)
            if (parsedLoose && Array.isArray(parsedLoose.toolCalls)) {
              toolCalls = parsedLoose.toolCalls
              toolCallsFromModel = toolCalls.length > 0
            }
          } catch {}
        }
      }
    } catch (_) {
      // ignore parse errors, treat as plain reply
    }

    // Step 2a: Try to parse toolCalls directly from the USER message (when users paste a JSON block)
    try {
      if (!toolCalls.length) {
        const msg = String(inputData.message || "")
        // 1) Fenced json in user message
        const fence = msg.match(/```json[\s\S]*?```/)
        const jsonStr = fence ? fence[0].replace(/```json|```/g, "").trim() : undefined
        if (jsonStr) {
          const parsed = JSON.parse(jsonStr)
          if (parsed && Array.isArray(parsed.toolCalls)) {
            toolCalls = parsed.toolCalls
            toolCallsFromUser = toolCalls.length > 0
          }
        }
        // 2) Plain JSON
        if (!toolCalls.length) {
          try {
            const parsedMsg = JSON.parse(msg)
            if (parsedMsg && Array.isArray(parsedMsg.toolCalls)) {
              toolCalls = parsedMsg.toolCalls
              toolCallsFromUser = toolCalls.length > 0
            }
          } catch {}
        }
      }
    } catch {}

    // Step 2b: infer tool calls.
    // - Always allow explicit METHOD /admin/... patterns from the user message.
    // - Only infer from the model reply when the user intent indicates an action.
    if (!toolCalls?.length) {
      const inferredFromUser = inferToolCallsFromMessage(inputData.message)
      const inferredFromReply = allowPlanning ? inferToolCallsFromMessage(text) : []
      const combined = [...inferredFromUser, ...inferredFromReply]
      if (combined.length) {
        // de-dup by name
        const seen = new Set<string>()
        toolCalls = combined.filter((c) => (seen.has(c.name) ? false : (seen.add(c.name), true)))
      }
    }

    // If tool calls came from the model, only accept them when the user intent indicates an action.
    // This prevents greetings like "hi" from producing admin_api_request plans.
    if (toolCalls?.length && toolCallsFromModel && !toolCallsFromUser && !allowPlanning) {
      toolCalls = []
    }

    // If still no toolCalls, try RAG to propose an endpoint based on the user's message
    if (!toolCalls?.length && shouldPlanToolCallsFromMessage(inputData.message)) {
      try {
        const msg = String(inputData.message || "").toLowerCase().trim()
        let rag: any[] = []
        // Use metadata filtering for clearer selection when intent is obvious (e.g., products)
        if (/\bproducts?\b/.test(msg)) {
          // Keep RAG in the loop but filter by path metadata to ensure we get product-related endpoints
          rag = await queryAdminEndpointsFiltered(String(inputData.message || "").trim(), {
            topK: 5,
            // do not force method; let RAG rank, but constrain to product paths
            pathIncludes: "products",
          })
        }
        // Fallback to generic RAG if no filtered results
        if (!Array.isArray(rag) || !rag.length) {
          rag = await queryAdminEndpoints(String(inputData.message || "").trim(), undefined, 5)
        }
        try { console.log("[AI][catalog][RAG] fallback", { count: rag?.length || 0, first: rag?.[0] }) } catch {}
        if (Array.isArray(rag) && rag.length) {
          const top = rag[0]
          // Extract IDs from the user's message to populate path params
          const rawMsg = String(inputData.message || "")
          const idMap: Record<string, any> = {}
          try {
            const prodMatch = rawMsg.match(/\bprod_[A-Za-z0-9]+\b/)
            if (prodMatch) {
              idMap.id = prodMatch[0]
              idMap.product_id = prodMatch[0]
            }
            const anyIdMatch = rawMsg.match(/\b(?:[a-z]{3,5})_[A-Za-z0-9]+\b/)
            if (!prodMatch && anyIdMatch) {
              idMap.id = anyIdMatch[0]
            }
          } catch {}
          const args: any = { method: top.method, path: top.path, openapi: { method: top.method, path: top.path } }
          if (Object.keys(idMap).length) args.path_params = idMap
          toolCalls = [
            {
              name: "admin_api_request",
              arguments: args,
            },
          ]
        }
      } catch (e) {
        try { console.warn("[AI][catalog][RAG] fallback error", ((e as any)?.message || e)) } catch {}
      }
    }

    // Step 3 (Tool-as-step): If any toolCalls present, activate them now via dispatcher
    let activations: Array<{ name: string; arguments: Record<string, any>; result: any }> = []
    if (toolCalls?.length) {
      for (let i = 0; i < toolCalls.length; i++) {
        const call = toolCalls[i]
        const result = await executeTool(call.name, call.arguments || {}, apiCtx)
        activations.push({ name: call.name, arguments: call.arguments || {}, result })
        // Sync corrected request back into toolCalls so UI sees the final, valid plan
        try {
          if (call.name === "admin_api_request" && result?.request) {
            const correctedMethod = result.request?.openapi?.method || result.request?.method
            const correctedPath = result.request?.openapi?.path || result.request?.path
            if (correctedMethod || correctedPath) {
              const prevArgs = call.arguments || {}
              const prevOpenapi = prevArgs.openapi || {}
              toolCalls[i] = {
                ...call,
                arguments: {
                  ...prevArgs,
                  method: correctedMethod || prevArgs.method,
                  path: correctedPath || prevArgs.path,
                  openapi: {
                    ...prevOpenapi,
                    method: correctedMethod || prevOpenapi.method,
                    path: correctedPath || prevOpenapi.path,
                  },
                },
              }
            }
          }
        } catch (e) {
          try { console.warn("[generalChat] toolCalls sync error", (e as any)?.message || e) } catch {}
        }
      }
    }

    // Post-process the human-readable reply to reflect any alias/normalization corrections
    // Example: model said "/inventory/items" but executeTool corrected to "/admin/inventory-items"
    let replyText = text
    try {
      if (toolCalls?.length && activations?.length) {
        for (let i = 0; i < toolCalls.length; i++) {
          const call = toolCalls[i]
          const act = activations[i]
          if (!call || !act) continue
          if (call.name === "admin_api_request") {
            const originalPath: string | undefined = (call.arguments as any)?.openapi?.path || (call.arguments as any)?.path
            const correctedPath: string | undefined = act?.result?.request?.openapi?.path || act?.result?.request?.path
            if (originalPath && correctedPath && originalPath !== correctedPath) {
              // Replace occurrences in the reply for better UX and add a short note
              const safeOrig = originalPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
              replyText = replyText.replace(new RegExp(safeOrig, "g"), correctedPath)
              replyText += `\n\nNote: Corrected endpoint path to ${correctedPath} based on the API catalog.`
            }
          }
        }
      }
    } catch (e) {
      try { console.warn("[generalChat] reply correction error", (e as any)?.message || e) } catch {}
    }

    // If we have valid activations, prefer a canonical summary over any misleading model text
    try {
      const firstAdmin = activations.find((a) => a?.name === "admin_api_request" && a?.result?.request)
      if (firstAdmin?.result?.request) {
        const req = firstAdmin.result.request
        const m = (req?.openapi?.method || req?.method || "").toUpperCase()
        const p = req?.openapi?.path || req?.path || ""
        const b = req?.body
        const bodyStr = b ? JSON.stringify(b, null, 2) : undefined
        replyText = [
          `Proposed admin_api_request: ${m} ${p}`,
          bodyStr ? `Body:\n${bodyStr}` : undefined,
          `Note: This is a planned request. Execution happens client-side.`,
        ].filter(Boolean).join("\n\n")
      }
    } catch (e) {
      try { console.warn("[generalChat] reply canonicalization error", (e as any)?.message || e) } catch {}
    }

    // If we have a summary of an executed API response from the UI, include it in the final reply
    if (executedSummary) {
      replyText = [replyText, `\nSummary of latest API result:\n${executedSummary}`].filter(Boolean).join("\n\n")
    }

    return {
      reply: replyText,
      toolCalls,
      activations,
      threadId: inputData.threadId,
      resourceId: inputData.resourceId,
    }
  },
})

export const generalChatWorkflow = createWorkflow({
  id: "generalChatWorkflow",
  inputSchema,
  outputSchema,
})
  .then(initApiCatalog)
  .then(chatGenerate)
  .commit()

// Streaming is handled via WorkflowRun.streamVNext() from the route using createRunAsync().

// ===== Catalog utilities (server-side, lazy, cached) =====
type Endpoint = { method: string; path: string }
let catalogCache: { ts: number; items: Endpoint[] } | null = null
const CATALOG_TTL_MS = 5 * 60 * 1000 // 5 minutes

async function getAllowedEndpoints(apiCtx?: { source?: string; allowedEndpoints?: Endpoint[] }): Promise<Endpoint[]> {
  // 1) If caller already provided small allowlist, use it
  const provided = apiCtx?.allowedEndpoints
  if (provided && provided.length) {
    try { console.log("[AI][catalog] using provided allowlist", { count: provided.length }) } catch {}
    return normalizeEndpoints(provided)
  }

  // Cache first
  if (catalogCache && Date.now() - catalogCache.ts < CATALOG_TTL_MS) {
    try { console.log("[AI][catalog] cache hit", { ttlMs: CATALOG_TTL_MS, count: catalogCache.items.length }) } catch {}
    return catalogCache.items
  }

  const f = (globalThis as any)?.fetch || fetch
  const headers: Record<string, string> = {}
  const headerOverride = process.env.ADMIN_OPENAPI_CATALOG_HEADER
  const token = process.env.ADMIN_OPENAPI_CATALOG_TOKEN
  if (headerOverride) {
    headers["Authorization"] = headerOverride
    try { console.log("[AI][catalog] auth header: override") } catch {}
  } else if (token) {
    // Accept either already prefixed or raw token per docs (Basic base64("<token>:")).
    const trimmed = String(token).trim()
    if (/^Basic\s+/i.test(trimmed)) {
      headers["Authorization"] = trimmed
      try { console.log("[AI][catalog] auth header: provided Basic") } catch {}
    } else {
      const basic = `Basic ${Buffer.from(`${trimmed}:`).toString("base64")}`
      headers["Authorization"] = basic
      try { console.log("[AI][catalog] auth header: built Basic from token") } catch {}
    }
  }

  // Resolve URL (allow env or apiCtx). Ensure absolute URL when provided path is relative.
  const rawUrl =
    process.env.ADMIN_OPENAPI_CATALOG_URL ||
    (isProbablyUrl(apiCtx?.source)
      ? String(apiCtx?.source)
      : String(apiCtx?.source || "")) ||
    "/admin/ai/openapi/catalog"
  function toAbsolute(u: string): string {
    if (!u) return ""
    if (/^https?:\/\//i.test(u)) return u
    // relative path → prefix with base
    const base = process.env.ADMIN_OPENAPI_BASE_URL || process.env.MEDUSA_BACKEND_URL || process.env.URL || ""
    if (!base) return ""
    return `${base.replace(/\/$/, "")}/${u.replace(/^\//, "")}`
  }
  const url = toAbsolute(rawUrl)
  if (!url) {
    try { console.warn("[AI][catalog] no valid catalog URL", { rawUrl, env: { ADMIN_OPENAPI_CATALOG_URL: Boolean(process.env.ADMIN_OPENAPI_CATALOG_URL), ADMIN_OPENAPI_BASE_URL: Boolean(process.env.ADMIN_OPENAPI_BASE_URL), MEDUSA_BACKEND_URL: Boolean(process.env.MEDUSA_BACKEND_URL), URL: Boolean(process.env.URL) } }) } catch {}
    return []
  }
  try {
    try { console.log("[AI][catalog] fetching", { url, withAuth: Boolean(token) }) } catch {}
    const r = await f(url, { headers })
    try { console.log("[AI][catalog] response", { status: r.status }) } catch {}
    if (!r.ok) {
      try { console.warn("[AI][catalog] non-OK status", { status: r.status }) } catch {}
      return []
    }
    const data = await r.json()
    // Expect either an array of endpoints or a full spec with paths
    const items = extractEndpointsFromCatalog(data)
    if (!items.length) {
      try { console.warn("[AI][catalog] zero endpoints from catalog; top-level keys", Object.keys(data || {})) } catch {}
    }
    catalogCache = { ts: Date.now(), items }
    try { console.log("[AI][catalog] loaded", { count: items.length }) } catch {}
    return items
  } catch {
    try { console.error("[AI][catalog] fetch error") } catch {}
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
    try { console.log("[AI][catalog] parse: root array endpoints", { count: data.length }) } catch {}
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
    try { console.log("[AI][catalog] parse: array wrapper endpoints", { count: mapped.length }) } catch {}
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
    try { console.log("[AI][catalog] parse: openapi paths", { count: items.length }) } catch {}
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
    try { console.log("[AI][catalog] index cache hit") } catch {}
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
  try { console.log("[AI][catalog] index built", { size: index.size }) } catch {}
  return index
}
