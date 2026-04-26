/**
 * AI Chat Hooks
 *
 * Hooks for AI chat that uses the hybrid query resolver.
 * Designed to be compatible with Vercel AI SDK patterns.
 */

import { useMutation, useQuery } from "@tanstack/react-query"
import { useState, useCallback, useRef } from "react"
import { sdk } from "../../lib/config"

// ============================================
// Types
// ============================================

export type AiChatMessage = {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  createdAt?: Date
}

export type AiChatResolvedQuery = {
  targetEntity: string
  mode: "data" | "analysis" | "create" | "update" | "chat"
  source: "indexed" | "bm25_llm" | "fallback"
  confidence: number
  patterns?: string[]
  executionPlanSteps?: number
}

export type AiChatPayload = {
  message: string
  threadId?: string
  resourceId?: string
}

export type AiChatResponse = {
  status: "completed" | "error"
  runId: string
  result?: {
    reply?: string
    mode?: string
    model?: string
    threadId?: string
    resolvedQuery?: AiChatResolvedQuery
    steps?: Array<{ id: string; type: string; ts: number; data?: any }>
  }
  meta?: {
    durationMs: number
    version: string
  }
  message?: string // Error message
}

export type AiChatStatusResponse = {
  status: string
  version: string
  workflow: {
    available: boolean
    name: string
  }
  config: {
    llm_configured: boolean
    features: string[]
  }
}

// ============================================
// Chat Hook (main hook)
// ============================================

export const useAiChat = () => {
  return useMutation({
    mutationFn: async (payload: AiChatPayload) => {
      const response = (await sdk.client.fetch(`/admin/ai/chat/chat`, {
        method: "POST",
        body: payload,
      })) as any

      return response as AiChatResponse
    },
  })
}

// ============================================
// Status Hook
// ============================================

export const useAiChatStatus = () => {
  return useQuery({
    queryKey: ["ai-chat-status"],
    queryFn: async () => {
      const response = (await sdk.client.fetch(`/admin/ai/chat/chat`, {
        method: "GET",
      })) as any
      return response as AiChatStatusResponse
    },
    staleTime: 60000, // Cache for 1 minute
  })
}

// ============================================
// Resolve-Only Hook
// ============================================

export type AiChatResolvePayload = {
  query: string
  options?: {
    useIndexedFirst?: boolean
    skipLLM?: boolean
  }
}

export type AiChatResolveResponse = {
  resolved: {
    query: string
    targetEntity: string
    mode: string
    patterns: string[]
    executionPlan: Array<{
      step: number
      action: string
      method: string
      code: string
      output: string
      explanation: string
    }>
    confidence: number
    resolvedAt: string
    source: string
    codeContext?: string
  }
  meta: {
    duration_ms: number
    indexed_docs: {
      relations: boolean
      links: boolean
    }
  }
}

export const useAiChatResolve = () => {
  return useMutation({
    mutationFn: async (payload: AiChatResolvePayload) => {
      const response = (await sdk.client.fetch(`/admin/ai/chat/resolve`, {
        method: "POST",
        body: payload,
      })) as any

      return response as AiChatResolveResponse
    },
  })
}

// ============================================
// Vercel AI SDK Compatible Hook
// ============================================

/**
 * useChat - Vercel AI SDK compatible hook for AI Chat
 *
 * This provides a similar interface to Vercel's useChat hook
 * but uses our backend.
 *
 * @example
 * ```tsx
 * const { messages, input, handleInputChange, handleSubmit, isLoading } = useAiChatCompat()
 *
 * return (
 *   <form onSubmit={handleSubmit}>
 *     <input value={input} onChange={handleInputChange} />
 *     <button type="submit" disabled={isLoading}>Send</button>
 *   </form>
 * )
 * ```
 */
export function useAiChatCompat(options?: {
  threadId?: string
  resourceId?: string
  onResponse?: (response: AiChatResponse) => void
  onError?: (error: Error) => void
}) {
  const [messages, setMessages] = useState<AiChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [lastResponse, setLastResponse] = useState<AiChatResponse | null>(null)

  const threadIdRef = useRef(options?.threadId || `thread_${Date.now()}`)
  const chat = useAiChat()

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setInput(e.target.value)
    },
    []
  )

  const append = useCallback(
    async (message: { role: "user"; content: string }) => {
      const userMessage: AiChatMessage = {
        id: `msg_${Date.now()}_user`,
        role: "user",
        content: message.content,
        createdAt: new Date(),
      }

      setMessages((prev) => [...prev, userMessage])
      setIsLoading(true)
      setError(null)

      try {
        const response = await chat.mutateAsync({
          message: message.content,
          threadId: threadIdRef.current,
          resourceId: options?.resourceId || "ai:chat",
        })

        setLastResponse(response)

        if (response.status === "completed" && response.result?.reply) {
          const assistantMessage: AiChatMessage = {
            id: `msg_${Date.now()}_assistant`,
            role: "assistant",
            content: response.result.reply,
            createdAt: new Date(),
          }
          setMessages((prev) => [...prev, assistantMessage])
        }

        options?.onResponse?.(response)
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        setError(error)
        options?.onError?.(error)
      } finally {
        setIsLoading(false)
      }
    },
    [chat, options]
  )

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault()
      if (!input.trim() || isLoading) return

      const content = input.trim()
      setInput("")
      await append({ role: "user", content })
    },
    [input, isLoading, append]
  )

  const reload = useCallback(async () => {
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")
    if (lastUserMessage) {
      // Remove last assistant message and resend
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === lastUserMessage.id)
        return prev.slice(0, idx)
      })
      await append({ role: "user", content: lastUserMessage.content })
    }
  }, [messages, append])

  const stop = useCallback(() => {
    setIsLoading(false)
  }, [])

  const clearMessages = useCallback(() => {
    setMessages([])
    setLastResponse(null)
    setError(null)
    threadIdRef.current = `thread_${Date.now()}`
  }, [])

  return {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    error,
    lastResponse,
    append,
    reload,
    stop,
    clearMessages,
    setInput,
    setMessages,
  }
}
