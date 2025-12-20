import { useMutation } from "@tanstack/react-query"
import { useRef, useState } from "react"
import { sdk } from "../../lib/config"

export type AiV2Step = {
  id: string
  type: string
  ts: number
  data?: any
  confidence?: number
  rationale_short?: string
}

export type AiV2WorkflowOutput = {
  reply?: string
  steps?: AiV2Step[]
  threadId?: string
  resourceId?: string
  suspended?: boolean
  suspendPayload?: any
  runId?: string
}

export type AiV2ChatPayload = {
  message: string
  threadId?: string
  resourceId?: string
  context?: Record<string, any>
}

export type AiV2ChatResponse = {
  status: "completed" | "suspended"
  runId: string
  suspendPayload?: any
  result?: AiV2WorkflowOutput
}

export const useAiV2Chat = () => {
  return useMutation({
    mutationFn: async (payload: AiV2ChatPayload) => {
      const response = (await sdk.client.fetch(`/admin/ai/v2/chat`, {
        method: "POST",
        body: payload,
      })) as any

      return response as AiV2ChatResponse
    },
  })
}

export type AiV2ResumePayload = {
  runId: string
  step?: string
  resumeData?: {
    confirmed?: boolean
    request?: {
      method?: string
      path?: string
      query?: any
      body?: any
    }
    context?: Record<string, any>
    selectedId?: string
    action?: string
  }
}

export type AiV2ResumeResponse =
  | {
      status: "completed"
      runId: string
      result: AiV2WorkflowOutput
    }
  | {
      status: "suspended"
      runId: string
      stepId?: string
      suspendPayload: any
      message?: string
    }

export const useAiV2Resume = () => {
  return useMutation({
    mutationFn: async ({ runId, step, resumeData }: AiV2ResumePayload) => {
      const response = (await sdk.client.fetch(`/admin/ai/v2/runs/${encodeURIComponent(runId)}/resume`, {
        method: "POST",
        body: { step, resumeData },
      })) as any

      return response as AiV2ResumeResponse
    },
  })
}

export type AiV2RunFeedbackPayload = {
  rating: "one" | "two" | "three" | "four" | "five"
  comment?: string
  status: "pending" | "reviewed" | "resolved"
  submitted_by: string
  submitted_at: Date | string
  reviewed_by?: string
  reviewed_at?: Date | string
  metadata?: Record<string, any>
}

export type AiV2RunFeedbackResponse = {
  feedback: any
}

export const useAiV2RunFeedback = () => {
  return useMutation({
    mutationFn: async ({ runId, payload }: { runId: string; payload: AiV2RunFeedbackPayload }) => {
      const response = (await sdk.client.fetch(`/admin/ai/v2/runs/${encodeURIComponent(runId)}/feedback`, {
        method: "POST",
        body: payload,
      })) as any

      return response as AiV2RunFeedbackResponse
    },
  })
}

export type AiV2StreamState = {
  isStreaming: boolean
  runId?: string
  active?: string
  error?: string | null
  final?: AiV2WorkflowOutput
  suspended?: { runId: string; suspendPayload: any }
  activity?: Array<{ id: string; ts: number; type: string; data?: any }>
  steps?: AiV2Step[]
  liveText?: string
}

export const useAiV2ChatStream = () => {
  const [state, setState] = useState<AiV2StreamState>({
    isStreaming: false,
    error: null,
    activity: [],
    steps: [],
    liveText: "",
  })

  const esRef = useRef<EventSource | null>(null)

  const stop = () => {
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
    setState((s) => ({ ...s, isStreaming: false, active: undefined }))
  }

  const pushActivity = (type: string, data?: any) => {
    const id =
      typeof crypto !== "undefined" && (crypto as any).randomUUID
        ? (crypto as any).randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`

    setState((s) => ({
      ...s,
      activity: [...(s.activity || []), { id, ts: Date.now(), type, data }].slice(-200),
    }))
  }

  const start = (payload: AiV2ChatPayload) => {
    stop()

    const params = new URLSearchParams()
    params.set("message", payload.message)
    if (payload.threadId) params.set("threadId", payload.threadId)
    if (payload.resourceId) params.set("resourceId", payload.resourceId)
    if (payload.context) params.set("context", JSON.stringify(payload.context))

    setState({ isStreaming: true, error: null, active: "Starting...", activity: [], steps: [], liveText: "" })

    const es = new EventSource(`/admin/ai/v2/chat/stream?${params.toString()}`)
    esRef.current = es

    const setActive = (label: string) => {
      setState((s) => ({ ...s, active: label }))
    }

    es.addEventListener("run:start", (e: any) => {
      try {
        const data = JSON.parse(e.data)
        setState((s) => ({ ...s, runId: data?.runId }))
        pushActivity("run:start", data)
      } catch {}
      setActive("Running...")
    })

    es.addEventListener("raw", (e: any) => {
      try {
        const data = JSON.parse(e.data)
        const rawType = String(data?.type || "raw")
        pushActivity(rawType, data?.payload)
      } catch {
        pushActivity("raw")
      }
    })

    es.addEventListener("step-start", (e: any) => {
      setActive("Running step...")
      try {
        const data = JSON.parse(e.data)
        pushActivity("step-start", data)
      } catch {
        pushActivity("step-start")
      }
    })

    es.addEventListener("step-output", (e: any) => {
      setActive("Processing...")
      try {
        const data = JSON.parse(e.data)
        pushActivity("step-output", data)

        // If the workflow step output includes steps array, capture it.
        const maybeSteps = data?.output?.steps || data?.steps
        if (Array.isArray(maybeSteps)) {
          setState((s) => ({ ...s, steps: maybeSteps }))
        }

        // If there's a reply preview, show as live text.
        const replyPreview = data?.output?.data?.replyPreview || data?.output?.replyPreview
        if (typeof replyPreview === "string" && replyPreview.trim()) {
          setState((s) => ({ ...s, liveText: replyPreview }))
        }
      } catch {
        pushActivity("step-output")
      }
    })

    es.addEventListener("step-result", (e: any) => {
      setActive("Processing result...")
      try {
        const data = JSON.parse(e.data)
        pushActivity("step-result", data)

        // Some events include step output/result with steps.
        const maybeSteps = data?.output?.steps || data?.result?.steps || data?.steps
        if (Array.isArray(maybeSteps)) {
          setState((s) => ({ ...s, steps: maybeSteps }))
        }
      } catch {
        pushActivity("step-result")
      }
    })

    es.addEventListener("run:suspended", (e: any) => {
      try {
        const data = JSON.parse(e.data)
        pushActivity("run:suspended", data)
        setState((s) => ({
          ...s,
          isStreaming: false,
          runId: data?.runId || s.runId,
          suspended: { runId: data?.runId || s.runId || "", suspendPayload: data?.suspendPayload },
          active: undefined,
        }))
      } catch {
        pushActivity("run:suspended")
        setState((s) => ({ ...s, isStreaming: false, active: undefined }))
      }
      stop()
    })

    es.addEventListener("run:final", (e: any) => {
      try {
        const data = JSON.parse(e.data)
        const out = data?.result
        pushActivity("run:final", data)
        setState((s) => ({
          ...s,
          isStreaming: false,
          runId: data?.runId || s.runId,
          final: out,
          active: undefined,
          steps: Array.isArray(out?.steps) ? out.steps : s.steps,
          liveText: "",
        }))
      } catch {
        pushActivity("run:final")
        setState((s) => ({ ...s, isStreaming: false, active: undefined }))
      }
    })

    es.addEventListener("run:error", (e: any) => {
      try {
        const data = JSON.parse(e.data)
        pushActivity("run:error", data)
        setState((s) => ({ ...s, isStreaming: false, error: data?.message || "stream error", active: undefined }))
      } catch {
        pushActivity("run:error")
        setState((s) => ({ ...s, isStreaming: false, error: "stream error", active: undefined }))
      }
      stop()
    })

    es.addEventListener("end", () => {
      stop()
    })

    es.onerror = () => {
      setState((s) => ({ ...s, isStreaming: false, error: "SSE connection error", active: undefined }))
      stop()
    }
  }

  return { state, start, stop }
}
