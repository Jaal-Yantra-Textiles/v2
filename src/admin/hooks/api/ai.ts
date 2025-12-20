import { FetchError } from "@medusajs/js-sdk"
import { UseMutationOptions, useMutation } from "@tanstack/react-query"
import { sdk } from "../../lib/config"
import { useEffect, useRef, useState } from "react"

export type EntityType = "raw_material" | "inventory_item"

export interface ImageExtractionPayload {
  image_url: string
  entity_type?: EntityType
  notes?: string
  verify?: Record<string, any>
  persist?: boolean
  threadId?: string
  resourceId?: string
  hints?: Record<string, any>
  defaults?: Record<string, any>
}

export interface ImageExtractionResponse<T = any> {
  result: T
}

export const useImageExtraction = (
  options?: UseMutationOptions<ImageExtractionResponse, FetchError, ImageExtractionPayload>
) => {
  return useMutation({
    mutationFn: async (payload: ImageExtractionPayload) => {
      const response = (await sdk.client.fetch(`/admin/ai/image-extraction`, {
        method: "POST",
        body: payload,
      })) as ImageExtractionResponse
      return response
    },
    ...options,
  })
}

export type ChatThread = {
  id: string
  resourceId: string
  title?: string
  createdAt?: string
  updatedAt?: string
  metadata?: Record<string, unknown>
}

export type ListChatThreadsPayload = {
  resourceId: string
  page?: number
  perPage?: number
}

export type ListChatThreadsResponse = {
  threads: ChatThread[]
  page: number
  perPage: number
  total: number
}

export const useChatThreads = (
  options?: UseMutationOptions<ListChatThreadsResponse, FetchError, ListChatThreadsPayload>
) => {
  return useMutation({
    mutationFn: async (payload: ListChatThreadsPayload) => {
      const params = new URLSearchParams()
      params.set("resourceId", payload.resourceId)
      if (payload.page !== undefined) params.set("page", String(payload.page))
      if (payload.perPage !== undefined) params.set("perPage", String(payload.perPage))

      const response = (await sdk.client.fetch(
        `/admin/ai/chat/threads?${params.toString()}`,
        { method: "GET" }
      )) as ListChatThreadsResponse
      return response
    },
    ...options,
  })
}

export type CreateChatThreadPayload = {
  resourceId: string
  threadId?: string
  title?: string
  metadata?: Record<string, unknown>
}

export type CreateChatThreadResponse = {
  thread: ChatThread
}

export const useCreateChatThread = (
  options?: UseMutationOptions<CreateChatThreadResponse, FetchError, CreateChatThreadPayload>
) => {
  return useMutation({
    mutationFn: async (payload: CreateChatThreadPayload) => {
      const response = (await sdk.client.fetch(`/admin/ai/chat/threads`, {
        method: "POST",
        body: payload,
      })) as CreateChatThreadResponse
      return response
    },
    ...options,
  })
}

export type GetChatThreadPayload = {
  threadId: string
  resourceId?: string
  page?: number
  perPage?: number
}

export type ChatUiMessage = {
  id?: string
  role?: string
  content?: any
  createdAt?: string
  metadata?: Record<string, unknown>
}

export type GetChatThreadResponse = {
  thread: ChatThread
  uiMessages: ChatUiMessage[]
  messages: any[]
  page: number
  perPage: number
}

export const useChatThread = (
  options?: UseMutationOptions<GetChatThreadResponse, FetchError, GetChatThreadPayload>
) => {
  return useMutation({
    mutationFn: async (payload: GetChatThreadPayload) => {
      const params = new URLSearchParams()
      if (payload.resourceId) params.set("resourceId", payload.resourceId)
      if (payload.page !== undefined) params.set("page", String(payload.page))
      if (payload.perPage !== undefined) params.set("perPage", String(payload.perPage))

      const qs = params.toString()
      const response = (await sdk.client.fetch(
        `/admin/ai/chat/threads/${encodeURIComponent(payload.threadId)}${qs ? `?${qs}` : ""}`,
        { method: "GET" }
      )) as GetChatThreadResponse
      return response
    },
    ...options,
  })
}

// -------------------------------------------------
// General Chat (non-streaming)
// -------------------------------------------------
export type GeneralChatPayload = {
  message: string
  threadId?: string
  resourceId?: string
  context?: Record<string, any>
  lastApiResponse?: any
}

export type GeneralChatResponse<T = any> = {
  result: T
}

export const useGeneralChat = (
  options?: UseMutationOptions<GeneralChatResponse, FetchError, GeneralChatPayload>
) => {
  return useMutation({
    mutationFn: async (payload: GeneralChatPayload) => {
      const response = (await sdk.client.fetch(`/admin/ai/chat`, {
        method: "POST",
        body: payload,
      })) as GeneralChatResponse
      return response
    },
    ...options,
  })
}

// -------------------------------------------------
// Visual Flow Codegen (execute_code AI assist)
// -------------------------------------------------
export type VisualFlowCodegenPayload = {
  prompt: string
  context?: Record<string, any>
  desiredOutputKeys?: string[]
  allowExternalPackages?: boolean
  threadId?: string
  resourceId?: string
}

export type VisualFlowCodegenResponse<T = any> = {
  result: T
}

export const useVisualFlowCodegen = (
  options?: UseMutationOptions<VisualFlowCodegenResponse, FetchError, VisualFlowCodegenPayload>
) => {
  return useMutation({
    mutationFn: async (payload: VisualFlowCodegenPayload) => {
      const response = (await sdk.client.fetch(`/admin/ai/visual-flow-codegen`, {
        method: "POST",
        body: payload,
      })) as VisualFlowCodegenResponse
      return response
    },
    ...options,
  })
}

// -------------------------------------------------
// General Chat Streaming (SSE)
// -------------------------------------------------
function sanitizeLLMText(input: string) {
  if (!input) return ""
  let text = input
  // Remove fenced code blocks with json
  text = text.replace(/```json[\s\S]*?```/g, "").trim()
  // Remove trailing 'json\n{...}' blocks
  text = text.replace(/\bjson\s*\n\s*\{[\s\S]*?\}\s*$/g, "").trim()
  return text
}

type ToolCall = { name: string; arguments: Record<string, any> }
type PlannedRequest = { method: string; path: string; body?: any; openapi?: { method: string; path: string } }
type Activation = { name: string; arguments: Record<string, any>; result?: any }
type ChatActions = { toolCalls: ToolCall[]; activations: Activation[]; planned: Array<{ tool: string; request: PlannedRequest }> }

type ChatStreamState = {
  isStreaming: boolean
  chunks: string[]
  error: string | null
  typed: string
  actions: ChatActions
  activeStep?: string
  suspended?: {
    runId: string
    reason: string
    options: Array<{ id: string; display: string }>
    actions?: Array<{ id: string; label: string }> // New field for actions like "View all"
    totalCount?: number // New field for total count
  }
}

export const useGeneralChatStream = () => {
  const [state, setState] = useState<ChatStreamState>({
    isStreaming: false,
    chunks: [],
    error: null,
    typed: "",
    actions: { toolCalls: [], activations: [], planned: [] },
    activeStep: undefined,
    suspended: undefined,
  })
  const esRef = useRef<EventSource | null>(null)

  // typing animation
  const queueRef = useRef<string[]>([])
  const animatorRef = useRef<number | null>(null)
  const gotAnyChunksRef = useRef(false)
  const summaryTextRef = useRef("")

  const stop = () => {
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
    setState((s) => ({ ...s, isStreaming: false, activeStep: undefined, suspended: undefined }))
    if (animatorRef.current) {
      window.clearTimeout(animatorRef.current)
      animatorRef.current = null
    }
    queueRef.current = []
    gotAnyChunksRef.current = false
    summaryTextRef.current = ""
  }

  // drain queue per letter
  const ensureAnimator = () => {
    if (animatorRef.current) return
    const tick = () => {
      const q = queueRef.current
      if (q.length > 0) {
        const ch = q.shift() as string
        setState((s) => ({ ...s, typed: s.typed + ch }))
      }
      animatorRef.current = window.setTimeout(tick, 12) as unknown as number
    }
    tick()
  }

  const start = (payload: GeneralChatPayload) => {
    stop()

    const params = new URLSearchParams()
    params.set("message", payload.message)
    if (payload.threadId) params.set("threadId", payload.threadId)
    if (payload.resourceId) params.set("resourceId", payload.resourceId)
    if (payload.context) params.set("context", JSON.stringify(payload.context))

    setState({
      isStreaming: true,
      chunks: [],
      error: null,
      typed: "",
      actions: { toolCalls: [], activations: [], planned: [] },
      activeStep: "Starting workflow...",
      suspended: undefined,
    })

    // Medusa route path (no Next.js /api prefix)
    const es = new EventSource(`/admin/ai/chat/stream?${params.toString()}`)
    esRef.current = es

    const pushText = (raw: string) => {
      const clean = sanitizeLLMText(raw)
      if (!clean) return
      // queue for per-letter typing
      queueRef.current.push(...clean.split(""))
      ensureAnimator()
    }

    // Listen for step updates
    es.addEventListener("workflow-step-start", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        const name = data?.stepName || data?.id || "Processing..."
        setState(s => ({ ...s, activeStep: `Running step: ${name}` }))
      } catch { }
    })

    es.addEventListener("workflow-step-result", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        const out = data?.output || {}

        if (out?.suspended === true && out?.runId && out?.suspendPayload) {
          setState((s) => ({
            ...s,
            suspended: {
              runId: String(out.runId),
              reason: String(out.suspendPayload?.reason || "Please select an option:"),
              options: Array.isArray(out.suspendPayload?.options) ? out.suspendPayload.options : [],
              actions: Array.isArray(out.suspendPayload?.actions) ? out.suspendPayload.actions : undefined,
              totalCount: typeof out.suspendPayload?.totalCount === "number" ? out.suspendPayload.totalCount : undefined,
            },
            activeStep: "Waiting for user input...",
            isStreaming: false,
          }))
          try {
            es.close()
          } catch { }
          if (esRef.current === es) {
            esRef.current = null
          }
          return
        }

        const toolCalls: ToolCall[] = Array.isArray(out?.toolCalls) ? out.toolCalls : []
        const activations: Activation[] = Array.isArray(out?.activations) ? out.activations : []

        const planned: Array<{ tool: string; request: PlannedRequest }> = []

        for (const tc of toolCalls) {
          if (tc.name === "admin_api_request" && tc.arguments) {
            planned.push({ tool: tc.name, request: tc.arguments as PlannedRequest })
          }
        }

        for (const a of activations) {
          const req = a?.result?.request
          if (req && (req.path || req.openapi?.path)) {
            planned.push({ tool: a.name, request: req })
          }
        }

        if (toolCalls.length || activations.length || planned.length) {
          setState((s) => ({
            ...s,
            actions: {
              toolCalls,
              activations,
              planned,
            },
          }))
        }
      } catch {
        // ignore parse errors
      }
    })

    es.addEventListener("workflow-finish", () => {
      setState(s => ({ ...s, activeStep: undefined }))
    })

    // HITL: Listen for suspended workflow events
    es.addEventListener("workflow:suspended", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        const { runId, suspendPayload } = data
        if (runId && suspendPayload) {
          setState((s) => ({
            ...s,
            suspended: {
              runId,
              reason: suspendPayload.reason,
              options: suspendPayload.options,
              actions: suspendPayload.actions,
              totalCount: suspendPayload.totalCount,
            },
            activeStep: "Waiting for user input...",
            isStreaming: false, // Stop streaming state (but keep connection if needed, though usually suspend closes connection)
          }))
          // Close event source since we are suspended
          es.close()
        }
      } catch (err) {
        console.error("Error parsing suspended event", err)
      }
    })

    es.addEventListener("chunk", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        const text = data?.text ?? ""
        const str = String(text)
        gotAnyChunksRef.current = true
        // Keep legacy chunks for compatibility
        setState((s) => ({ ...s, activeStep: "Generating response...", chunks: [...s.chunks, str] }))
        pushText(str)
      } catch {
        // ignore parse errors
      }
    })

    // Optional: show status, not text
    es.addEventListener("start", () => { })
    es.addEventListener("step-start", () => { })
    es.addEventListener("step-result", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        const result = data?.result || {}
        let toolCalls: ToolCall[] = Array.isArray(result?.toolCalls) ? result.toolCalls : []
        const activations: Activation[] = Array.isArray(result?.activations) ? result.activations : []

        // Extract planned requests from BOTH toolCalls (pending) and activations (executed returning request plan)
        const planned: Array<{ tool: string; request: PlannedRequest }> = []

        // 1. Pending tool calls are planned actions
        for (const tc of toolCalls) {
          if (tc.name === "admin_api_request" && tc.arguments) {
            planned.push({ tool: tc.name, request: tc.arguments as PlannedRequest })
          }
        }

        // 2. Activations might return a "request" object (legacy pattern or server-side planning)
        for (const a of activations) {
          const req = a?.result?.request
          if (req && (req.path || req.openapi?.path)) {
            planned.push({ tool: a.name, request: req })
          }
        }

        if (toolCalls.length || activations.length || planned.length) {
          setState((s) => ({
            ...s,
            actions: {
              toolCalls,
              activations,
              planned,
            },
          }))
        }
      } catch {
        // ignore parse errors
      }
    })

    // Preferred: server emits final, normalized structured output
    es.addEventListener("result", (e: MessageEvent) => {
      try {
        const out = JSON.parse(e.data || "{}")

        if (out?.suspended === true && out?.runId && out?.suspendPayload) {
          setState((s) => ({
            ...s,
            suspended: {
              runId: String(out.runId),
              reason: String(out.suspendPayload?.reason || "Please select an option:"),
              options: Array.isArray(out.suspendPayload?.options) ? out.suspendPayload.options : [],
              actions: Array.isArray(out.suspendPayload?.actions) ? out.suspendPayload.actions : undefined,
              totalCount: typeof out.suspendPayload?.totalCount === "number" ? out.suspendPayload.totalCount : undefined,
            },
            activeStep: "Waiting for user input...",
            isStreaming: false,
          }))
          try {
            es.close()
          } catch { }
          if (esRef.current === es) {
            esRef.current = null
          }
          return
        }

        const toolCalls: ToolCall[] = Array.isArray(out?.toolCalls) ? out.toolCalls : []
        const activations: Activation[] = Array.isArray(out?.activations)
          ? out.activations
          : []

        const planned: Array<{ tool: string; request: PlannedRequest }> = []

        // 1. Pending tool calls are planned actions
        for (const tc of toolCalls) {
          if (tc.name === "admin_api_request" && tc.arguments) {
            planned.push({ tool: tc.name, request: tc.arguments as PlannedRequest })
          }
        }

        // 2. Activations check
        for (const a of activations) {
          const req = a?.result?.request
          if (req && (req.path || req.openapi?.path)) {
            planned.push({ tool: a.name, request: req })
          }
        }

        setState((s) => ({
          ...s,
          actions: { toolCalls, activations, planned },
        }))
      } catch {
        // ignore parse errors
      }
    })

    es.addEventListener("summary", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        const reply = typeof data?.reply === "string" ? data.reply : ""
        const clean = sanitizeLLMText(reply)
        summaryTextRef.current = clean
        if (!gotAnyChunksRef.current && clean) {
          // keep legacy chunks array only when no chunks were streamed
          setState((s) => ({ ...s, chunks: [...s.chunks, clean] }))
          pushText(clean)
        }
      } catch {
        // ignore parse errors
      }
    })

    es.addEventListener("error", (e: MessageEvent) => {
      try {
        const data = JSON.parse((e as any).data || "{}")
        setState((s) => ({ ...s, error: data?.message || "stream error" }))
      } catch {
        setState((s) => ({ ...s, error: "stream error" }))
      }
    })

    es.addEventListener("end", () => {
      // If nothing streamed, fallback to summary
      if (!gotAnyChunksRef.current && summaryTextRef.current) {
        pushText(summaryTextRef.current)
      }

      try {
        es.close()
      } catch { }
      if (esRef.current === es) {
        esRef.current = null
      }
      setState((s) => ({ ...s, isStreaming: false, activeStep: undefined }))
    })
  }

  useEffect(() => {
    return () => stop()
  }, [])

  return { start, stop, state }
}
