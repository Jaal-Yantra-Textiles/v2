// @ts-nocheck
import { createWorkflow, createStep } from "@mastra/core/workflows"
import { z } from "zod"
import { v4 as uuidv4 } from "uuid"
import { generalChatAgent } from "../../agents"
import { ingestAdminCatalog, queryAdminEndpoints } from "../../rag/adminCatalog"
import { multiStepApiRequestWorkflow } from "../multiStepApiRequest"
import { runStorage } from "../../run-storage"

const MAX_TOOL_LOOPS = 4
const MAX_TOOL_RESULT_CHARS = 8000
const RAG_TOP_K = 8

const inputSchema = z.object({
  message: z.string(),
  threadId: z.string().optional(),
  resourceId: z.string().optional(),
  context: z.record(z.any()).optional(),
})

const routedSchema = inputSchema.extend({
  mode: z.enum(["chat", "tool", "hitl"]).default("tool"),
})

const retrievedSchema = routedSchema.extend({
  candidates: z.any().optional(),
})

const outputSchema = z.object({
  reply: z.string().optional(),
  steps: z.array(z.any()).optional(),
  threadId: z.string().optional(),
  resourceId: z.string().optional(),
  suspended: z.boolean().optional(),
  suspendPayload: z.any().optional(),
  runId: z.string().optional(),
})

const toolCallSchema = z.object({
  name: z.literal("admin_api_request"),
  arguments: z.object({
    method: z.string().optional(),
    path: z.string(),
    query: z.record(z.any()).optional(),
    body: z.record(z.any()).optional(),
    openapi: z
      .object({
        method: z.string().optional(),
        path: z.string().optional(),
      })
      .optional(),
  }),
})

const toolPlanSchema = z
  .object({
    toolCalls: z.array(toolCallSchema).optional(),
    final: z.string().optional(),
  })
  .refine((v) => Boolean(v.toolCalls?.length) || Boolean(v.final?.trim()), {
    message: "Must return either toolCalls or final",
  })

const writeConfirmSuspendSchema = z.object({
  reason: z.string(),
  requires_confirmation: z.literal(true),
  request: z.object({
    method: z.string(),
    path: z.string(),
    query: z.record(z.any()).optional(),
    body: z.record(z.any()).optional(),
  }),
})

const writeConfirmResumeSchema = z.object({
  confirmed: z.boolean(),
  request: z
    .object({
      method: z.string(),
      path: z.string(),
      query: z.record(z.any()).optional(),
      body: z.record(z.any()).optional(),
    })
    .optional(),
  context: z.record(z.any()).optional(),
})

function sanitizeAssistantText(text: string): string {
  try {
    if (!text) return ""
    return String(text).replace(/```json[\s\S]*?```/g, "").trim()
  } catch {
    return String(text || "")
  }
}

function safeToText(v: any, max = 900): string {
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

function buildListPreview(data: any, maxItems = 50) {
  if (!data || typeof data !== "object") return null
  const keys = [
    "products",
    "orders",
    "customers",
    "inventory_items",
    "inventoryItems",
    "variants",
    "collections",
    "categories",
    "regions",
  ]
  const arrKey = keys.find((k) => Array.isArray((data as any)[k]))
  if (!arrKey) return null

  const items = ((data as any)[arrKey] as any[]).slice(0, maxItems)
  const mapped = items.map((it) => ({
    id: it?.id,
    title: it?.title ?? it?.name ?? it?.handle ?? it?.sku,
    handle: it?.handle,
    sku: it?.sku,
    status: it?.status,
  }))

  return {
    key: arrKey,
    count: Array.isArray((data as any)[arrKey]) ? (data as any)[arrKey].length : undefined,
    next: (data as any)?.next,
    offset: (data as any)?.offset,
    limit: (data as any)?.limit,
    items: mapped,
  }
}

function buildObservationPreview(data: any) {
  const listPreview = buildListPreview(data)
  if (listPreview) {
    return safeToText(listPreview, MAX_TOOL_RESULT_CHARS)
  }
  return safeToText(data, MAX_TOOL_RESULT_CHARS)
}

function withDefaultListLimit(input: { method: string; path: string; query?: any; body?: any }) {
  const method = String(input?.method || "GET").toUpperCase()
  if (method !== "GET") return input

  const path = String(input?.path || "")
  const query = input?.query
  if (query && typeof query === "object" && "limit" in query) {
    return input
  }

  // Only apply to collection endpoints like /admin/products
  const cleanPath = path.split("?")[0]
  if (!cleanPath.startsWith("/admin/")) return input
  if (cleanPath.includes("{")) return input

  const segs = cleanPath.split("/").filter(Boolean)
  // ["admin", "products"] => collection endpoint
  if (segs.length !== 2) return input

  const nextQuery = query && typeof query === "object" ? { ...query } : {}
  return { ...input, query: { limit: 50, ...nextQuery } }
}

function shouldPlanToolCallsFromMessage(message: string): boolean {
  const msg = String(message || "").toLowerCase().trim()
  if (!msg) return false
  const compact = msg.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()
  const action = /\b(list|show|get|fetch|find|search|create|add|make|new|update|edit|modify|change|set|patch|delete|remove|archive|cancel|refund|fulfill|ship|mark)\b/.test(
    compact
  )
  if (!action) return false
  if (compact.split(" ").length <= 2) return false
  return true
}

function looksLikeListAllQuery(message: string): boolean {
  const m = String(message || "").toLowerCase()
  if (!m.trim()) return false
  return /\b(list|show|get|fetch)\b/.test(m) && /\b(all|everything)\b/.test(m)
}

function userExplicitlyRequestedWrite(message: string): boolean {
  const m = String(message || "").toLowerCase()
  // Only treat as explicit if the user asked to change/create/delete something.
  return /\b(update|change|rename|edit|modify|set|create|add|delete|remove|archive|cancel)\b/.test(m)
}

function normalizeWriteRequest(req: { method: string; path: string; query?: any; body?: any }) {
  const method = String(req?.method || "GET").toUpperCase()
  const path = String(req?.path || "")
  let query = req?.query
  let body = req?.body

  // Models often put body params into query for write calls.
  if (method !== "GET" && method !== "HEAD") {
    const isBodyMissing = body == null || (typeof body === "object" && Object.keys(body).length === 0)
    const hasQueryObject = query && typeof query === "object" && Object.keys(query).length > 0
    if (isBodyMissing && hasQueryObject) {
      body = query
      query = undefined
    }
  }

  return { method, path, query, body }
}

function pickFallbackCollectionGet(candidates: any[], message: string): { method: string; path: string; query?: any } | null {
  if (!Array.isArray(candidates) || !candidates.length) return null
  if (!looksLikeListAllQuery(message)) return null

  // Prefer a canonical collection endpoint: GET /admin/<resource> without path params
  const collection = candidates.find((c: any) => {
    const method = String(c?.method || "").toUpperCase()
    const path = String(c?.path || "")
    if (method !== "GET") return false
    if (!path.startsWith("/admin/")) return false
    if (path.includes("{")) return false
    // avoid obvious non-list subresources
    return true
  })

  if (!collection) return null
  return {
    method: "GET",
    path: String(collection.path),
    query: { limit: 50 },
  }
}

async function executeServerSide(
  request: { method: string; path: string; query?: any; body?: any },
  authHeaders?: { authorization?: string; cookie?: string }
) {
  const backendUrl =
    process.env.MEDUSA_BACKEND_URL || process.env.URL || "http://localhost:9000"

  const url = new URL(`${backendUrl}${request.path}`)
  if (request.query) {
    Object.entries(request.query).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.append(k, String(v))
    })
  }

  const method = String(request.method || "GET").toUpperCase()
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (authHeaders?.authorization) headers["Authorization"] = authHeaders.authorization
  if (authHeaders?.cookie) headers["Cookie"] = authHeaders.cookie

  const init: RequestInit = { method, headers }
  if (request.body && method !== "GET" && method !== "HEAD") {
    init.body = JSON.stringify(request.body)
  }

  try {
    const res = await fetch(url.toString(), init)
    const text = await res.text()
    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }

    return { status: res.status, ok: res.ok, data }
  } catch (error) {
    return { status: 500, ok: false, error: (error as Error).message }
  }
}

const initApiCatalog = createStep({
  id: "aiv2:init-api-catalog",
  inputSchema,
  outputSchema: inputSchema,
  execute: async ({ inputData }) => {
    try {
      void ingestAdminCatalog(false).catch(() => undefined)
    } catch {
      // non-fatal
    }
    return inputData
  },
})

const routeIntent = createStep({
  id: "aiv2:route-intent",
  inputSchema,
  outputSchema: routedSchema,
  execute: async ({ inputData }) => {
    const msg = String(inputData.message || "")
    const wantsTool = shouldPlanToolCallsFromMessage(msg)

    // For now: keep HITL only for explicit orders-by-customer patterns.
    const wantsOrders = /\borders?\b/i.test(msg)
    const wantsOrdersForName = /\borders?\b[\s\S]*\b(?:for|of)\b\s+\S+/i.test(msg)
    const mode = wantsOrders && wantsOrdersForName ? "hitl" : wantsTool ? "tool" : "chat"

    return { ...inputData, mode }
  },
})

const retrieveCandidates = createStep({
  id: "aiv2:retrieve",
  inputSchema: routedSchema,
  outputSchema: retrievedSchema,
  execute: async ({ inputData }) => {
    if (inputData.mode !== "tool") return { ...inputData, candidates: [] }

    let candidates: any[] = []
    try {
      candidates = await queryAdminEndpoints(String(inputData.message || ""), undefined, RAG_TOP_K)
    } catch {
      candidates = []
    }

    return { ...inputData, candidates }
  },
})

const runAi = createStep({
  id: "aiv2:run",
  inputSchema: retrievedSchema,
  outputSchema,
  suspendSchema: writeConfirmSuspendSchema,
  resumeSchema: writeConfirmResumeSchema,
  execute: async ({ inputData, resumeData, suspend }) => {
    const threadId = inputData.threadId
    const resourceId = inputData.resourceId || "ai:v2"
    const mergedContext = {
      ...(inputData?.context || {}),
      ...((resumeData as any)?.context || {}),
    }
    const contextAuth = (mergedContext as any)?.auth_headers

    const steps: any[] = []
    const pushStep = (type: string, data?: any, extra?: any) => {
      steps.push({ id: uuidv4(), type, ts: Date.now(), ...(extra || {}), data })
    }

    pushStep("route", { mode: inputData.mode })

    if (inputData.mode === "hitl") {
      const externalRunId = uuidv4()
      const run = await multiStepApiRequestWorkflow.createRunAsync({ runId: externalRunId })
      runStorage.set(externalRunId, run)

      const result = await run.start({
        inputData: {
          message: inputData.message,
          threadId,
          context: inputData.context,
        },
      })

      if (result?.status === "suspended") {
        const suspendedFirst = (result as any).suspended?.[0]
        const stepId = typeof suspendedFirst === "string" ? suspendedFirst : suspendedFirst?.stepId
        const suspendPayload = stepId ? (result as any).steps?.[stepId]?.suspendPayload : null

        pushStep("suspended", { stepId, suspendPayload })

        return {
          suspended: true,
          runId: externalRunId,
          suspendPayload,
          steps,
          threadId,
          resourceId,
        }
      }

      runStorage.delete(externalRunId)
      const finalData = (result as any)?.result ?? (result as any)?.state?.[0]?.output ?? result
      const reply = `HITL workflow completed.\n\n${safeToText(finalData, 1800)}`

      pushStep("finalize", { replyPreview: reply.slice(0, 300) })

      return { reply, steps, threadId, resourceId }
    }

    if (inputData.mode === "chat") {
      const gen = await generalChatAgent.generate([
        { role: "system", content: "You are a helpful assistant for an admin." },
        { role: "user", content: String(inputData.message || "") },
      ], {
        memory: { thread: threadId, resource: resourceId },
      })

      const text = (gen as any)?.text || ""
      const reply = sanitizeAssistantText(text)
      pushStep("finalize", { replyPreview: reply.slice(0, 300) })
      return { reply, steps, threadId, resourceId }
    }

    // tool mode
    pushStep("retrieve", {
      topK: RAG_TOP_K,
      candidates: Array.isArray(inputData.candidates)
        ? inputData.candidates.slice(0, RAG_TOP_K).map((c: any) => ({
            method: c?.method,
            path: c?.path,
            score: c?.score,
            summary: c?.summary,
            tags: c?.tags,
          }))
        : [],
    })

    const opsBlock = Array.isArray(inputData.candidates) && inputData.candidates.length
      ? inputData.candidates
          .slice(0, RAG_TOP_K)
          .map((c: any, i: number) => {
            const method = String(c?.method || "").toUpperCase()
            const path = String(c?.path || "")
            const summary = safeToText(c?.summary || c?.description || "", 220)
            return `${i + 1}) ${method} ${path}${summary ? `\nSummary: ${summary}` : ""}`
          })
          .join("\n\n")
      : "(no candidates)"

    const systemPrompt = [
      "You are an AI admin assistant.",
      "You can call Admin API tools to fetch data.",
      "Only call tools using method/path pairs from the provided list.",
      "Only use GET unless the user explicitly requests a write operation.",
      "For GET requests, put query params in 'query' (not 'body').",
      "For list endpoints, default to query.limit=50 unless the user specifies otherwise.",
      "For write requests (POST/PUT/PATCH/DELETE), put payload in 'body' (not 'query').",
      "If you propose a write request, it will require user confirmation before execution.",
      "If you need data, return toolCalls. If you have enough data, return final.",
      "",
      "Available operations:",
      opsBlock,
      "",
      "Return JSON only.",
    ].join("\n")

    const convo: Array<{ role: string; content: string }> = [
      { role: "system", content: systemPrompt },
      { role: "user", content: String(inputData.message || "") },
    ]

    let finalReply = ""
    let executedAtLeastOne = false

    // If resuming a write confirmation, execute the confirmed request first.
    if (resumeData?.confirmed && (resumeData as any)?.request) {
      const normalized0 = normalizeWriteRequest((resumeData as any).request)
      const method0 = normalized0.method
      const path0 = normalized0.path
      const query0 = normalized0.query
      const body0 = normalized0.body

      pushStep("tool_call", { method: method0, path: path0, query: query0, body: body0 }, { confidence: 0.75, rationale_short: "confirmed_write" })

      const execRes0 = await executeServerSide(withDefaultListLimit({ method: method0, path: path0, query: query0, body: body0 }), contextAuth)
      executedAtLeastOne = true

      pushStep("observation", {
        method: method0,
        path: path0,
        status: execRes0?.status,
        ok: execRes0?.ok,
        preview: buildObservationPreview(execRes0?.data),
      })

      convo.push({
        role: "assistant",
        content: [
          `Tool result: ${method0} ${path0}`,
          `Status: ${execRes0.status}`,
          `JSON: ${safeToText(execRes0.data, MAX_TOOL_RESULT_CHARS)}`,
        ].join("\n"),
      })
      convo.push({
        role: "user",
        content: "Summarize what changed and confirm the requested update was applied (or explain any error).",
      })
    }

    for (let i = 0; i < MAX_TOOL_LOOPS; i++) {
      const gen = await generalChatAgent.generate(convo, {
        output: toolPlanSchema,
        memory: { thread: threadId, resource: resourceId },
      })

      const obj = (gen as any)?.object || {}
      const toolCalls = Array.isArray(obj?.toolCalls) ? obj.toolCalls : []
      const final = typeof obj?.final === "string" ? obj.final : ""

      // If the model didn't emit tool calls, try a deterministic fallback based on retrieved candidates.
      if (!toolCalls?.length) {
        const fallback = pickFallbackCollectionGet(inputData.candidates, inputData.message)
        if (fallback && !executedAtLeastOne) {
          pushStep("tool_call", { method: fallback.method, path: fallback.path, query: fallback.query }, { confidence: 0.55, rationale_short: "fallback_collection_get" })
          const execRes = await executeServerSide(
            withDefaultListLimit({ method: fallback.method, path: fallback.path, query: fallback.query }),
            contextAuth
          )
          executedAtLeastOne = true

          pushStep("observation", {
            method: fallback.method,
            path: fallback.path,
            status: execRes?.status,
            ok: execRes?.ok,
            preview: buildObservationPreview(execRes?.data),
          })

          convo.push({
            role: "assistant",
            content: [
              `Tool result: ${fallback.method} ${fallback.path}`,
              `Status: ${execRes.status}`,
              `JSON: ${safeToText(execRes.data, MAX_TOOL_RESULT_CHARS)}`,
            ].join("\n"),
          })
          convo.push({
            role: "user",
            content: "Using the tool results above, answer the user's question in a helpful admin-friendly summary.",
          })
          continue
        }

        // If the model returned a final answer, use it; else fallback to empty.
        finalReply = sanitizeAssistantText(final)
        break
      }

      for (const tc of toolCalls) {
        const methodRaw = String(tc?.arguments?.method || tc?.arguments?.openapi?.method || "GET")
        const pathRaw = String(tc?.arguments?.path || tc?.arguments?.openapi?.path || "")
        const normalized = normalizeWriteRequest({
          method: methodRaw,
          path: pathRaw,
          query: tc?.arguments?.query,
          body: tc?.arguments?.body,
        })

        const method = normalized.method
        const path = normalized.path
        const query = normalized.query
        const body = normalized.body

        pushStep("tool_call", { method, path, query, body }, { confidence: 0.7 })

        if (method !== "GET") {
          // Only execute writes after explicit user intent + confirmation.
          if (!userExplicitlyRequestedWrite(inputData.message)) {
            pushStep("observation", { status: "rejected_write_not_requested", method, path })
            convo.push({
              role: "assistant",
              content: `Write request rejected because user did not explicitly request a write: ${method} ${path}`,
            })
            continue
          }

          // If we already resumed and executed the confirmed write, don't re-suspend.
          if (resumeData?.confirmed) {
            pushStep("observation", { status: "skipped_already_confirmed", method, path })
            continue
          }

          const reason =
            `Confirmation required to perform write operation: ${method} ${path}. ` +
            "Please confirm to proceed."

          return await suspend({
            reason,
            requires_confirmation: true,
            request: { method, path, query, body },
          })
        }

        const execRes = await executeServerSide(withDefaultListLimit({ method, path, query }), contextAuth)
        executedAtLeastOne = true
        const obs = {
          method,
          path,
          status: execRes?.status,
          ok: execRes?.ok,
          preview: buildObservationPreview(execRes?.data),
        }

        pushStep("observation", obs)

        convo.push({
          role: "assistant",
          content: [
            `Tool result: ${method} ${path}`,
            `Status: ${execRes.status}`,
            `JSON: ${safeToText(execRes.data, MAX_TOOL_RESULT_CHARS)}`,
          ].join("\n"),
        })
      }

      convo.push({
        role: "user",
        content:
          "Using the tool results above, answer the user's question. If you need more data, call admin_api_request again.",
      })
    }

    if (!finalReply) {
      const finalGen = await generalChatAgent.generate(convo, {
        memory: { thread: threadId, resource: resourceId },
      })
      finalReply = sanitizeAssistantText((finalGen as any)?.text || "")
    }

    pushStep("finalize", { replyPreview: finalReply.slice(0, 300) })

    return { reply: finalReply, steps, threadId, resourceId }
  },
})

export const aiV2Workflow = createWorkflow({
  id: "aiV2Workflow",
  inputSchema,
  outputSchema,
})
  .then(initApiCatalog)
  .then(routeIntent)
  .then(retrieveCandidates)
  .then(runAi)
  .commit()
