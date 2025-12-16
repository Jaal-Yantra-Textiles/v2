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

// -------------------------------------------------
// General Chat (non-streaming)
// -------------------------------------------------
export type GeneralChatPayload = {
  message: string
  threadId?: string
  resourceId?: string
  context?: Record<string, any>
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

type ChatStreamState = {
  isStreaming: boolean
  chunks: string[]
  error: string | null
  typed: string
  actions: ChatActions
}

type ToolCall = { name: string; arguments: Record<string, any> }
type PlannedRequest = { method: string; path: string; body?: any; openapi?: { method: string; path: string } }
type Activation = { name: string; arguments: Record<string, any>; result?: any }
type ChatActions = { toolCalls: ToolCall[]; activations: Activation[]; planned: Array<{ tool: string; request: PlannedRequest }> }

export const useGeneralChatStream = () => {
  const [state, setState] = useState<ChatStreamState>({
    isStreaming: false,
    chunks: [],
    error: null,
    typed: "",
    actions: { toolCalls: [], activations: [], planned: [] },
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
    setState((s) => ({ ...s, isStreaming: false }))
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

    es.addEventListener("chunk", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        const text = data?.text ?? ""
        const str = String(text)
        gotAnyChunksRef.current = true
        // Keep legacy chunks for compatibility
        setState((s) => ({ ...s, chunks: [...s.chunks, str] }))
        pushText(str)
      } catch {
        // ignore parse errors
      }
    })

    // Optional: show status, not text
    es.addEventListener("start", () => {})
    es.addEventListener("step-start", () => {})
    es.addEventListener("step-result", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        const result = data?.result || {}
        let toolCalls: ToolCall[] = Array.isArray(result?.toolCalls) ? result.toolCalls : []
        const activations: Activation[] = Array.isArray(result?.activations) ? result.activations : []

        // Extract planned requests from activations (our workflow returns result.request for planned tools)
        const planned: Array<{ tool: string; request: PlannedRequest }> = []
        for (const a of activations) {
          const req = a?.result?.request
          if (req && (req.path || req.openapi?.path)) {
            planned.push({ tool: a.name, request: req })
          }
        }

        // Fallback: if server didn't parse toolCalls but reply text contains a JSON block, parse it here
        if ((!toolCalls || toolCalls.length === 0) && typeof result?.reply === "string") {
          const text: string = result.reply
          // Try fenced ```json
          let jsonStr: string | undefined
          const fenceMatch = text.match(/```json[\s\S]*?```/)
          if (fenceMatch) {
            jsonStr = fenceMatch[0].replace(/```json|```/g, "").trim()
          } else {
            // Try loose 'json\n{...}' pattern or first {...}
            const idx = text.indexOf("{")
            if (idx !== -1) {
              const possible = text.slice(idx)
              const last = possible.lastIndexOf("}")
              jsonStr = last !== -1 ? possible.slice(0, last + 1) : possible
            }
          }
          if (jsonStr) {
            try {
              const parsed = JSON.parse(jsonStr)
              if (parsed && Array.isArray(parsed.toolCalls)) {
                toolCalls = parsed.toolCalls
              }
            } catch {}
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
      stop()
    })
  }

  useEffect(() => {
    return () => stop()
  }, [])

  return { start, stop, state }
}
