import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { mastra } from "../../../../../mastra"
import { generalChatAgent } from "../../../../../mastra/agents"
import { MedusaError } from "@medusajs/framework/utils"
import {
  AdminGeneralChatStreamQuery,
  AdminGeneralChatStreamQueryType,
} from "../validators"

// Simple SSE helper
function sseEvent(res: MedusaResponse, event: string, data: any) {
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  // Enable SSE headers
  res.setHeader("Content-Type", "text/event-stream")
  res.setHeader("Cache-Control", "no-cache, no-transform")
  res.setHeader("Connection", "keep-alive")
    // Node/express compatibility
    ; (res as any).flushHeaders?.()

  try {
    const parsed = AdminGeneralChatStreamQuery.safeParse(
      ((req as any).validatedQuery || req.query || {}) as AdminGeneralChatStreamQueryType
    )

    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => e.message).join(", ")
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        message || "Invalid query"
      )
    }

    const { message, threadId, resourceId: qResourceId, context } = parsed.data
    const resourceId = qResourceId || "ai:general-chat"

    const controller = new AbortController()
      ; (req as any).on?.("close", () => {
        try { controller.abort() } catch { }
      })

    // ---------------------------------------------------------
    // PRIMARY STREAMING STRATEGY
    // ---------------------------------------------------------
    // We use the workflow's streamVNext which handles tool execution properly.
    // This is more robust than trying to stream from the agent and then run a workflow.

    try {
      const wf = mastra.getWorkflow("generalChatWorkflow")
      if (!wf || !(wf as any).createRunAsync) {
        throw new Error("Workflow not found or invalid")
      }

      const run = await (wf as any).createRunAsync()
      const stream = (run as any).streamVNext({
        inputData: {
          message,
          threadId,
          resourceId,
          context: {
            ...(context || {}),
            auth_headers: {
              authorization: req.headers.authorization,
              cookie: req.headers.cookie,
            },
          },
        },
      })

      const fullStream = (stream as any)?.fullStream || stream
      let textBuffer = ""
      let finalResult: any = null
      let sentFinal = false

      for await (const ev of fullStream as any) {
        switch (ev?.type) {
          case "start":
          case "step-start":
            sseEvent(res, ev.type, ev.payload ?? {})
            break
          case "step-output": {
            const payload = ev.payload ?? {}
            const maybeText = payload?.text ?? payload?.delta ?? payload?.data
            if (maybeText) {
              const text = String(maybeText)
              textBuffer += text
              sseEvent(res, "chunk", { text })
            } else {
              sseEvent(res, "step-output", payload)
            }
            break
          }
          case "step-result":
            sseEvent(res, "step-result", ev.payload ?? {})
            break
          case "finish": {
            try {
              finalResult = ev?.payload?.result ?? (await (stream as any).result) ?? null
            } catch {
              finalResult = null
            }

            // Construct the final output object compatible with the frontend
            const out = normalizeResult(finalResult, threadId || "", resourceId || "ai:general-chat", textBuffer)

            if (out.reply && out.reply.trim()) {
              sseEvent(res, "summary", { reply: out.reply })
            } else if (textBuffer) {
              sseEvent(res, "summary", { reply: textBuffer })
            }

            sseEvent(res, "result", out)
            sseEvent(res, "end", { done: true })
            sentFinal = true
            break
          }
          default:
            sseEvent(res, ev?.type || "event", ev?.payload ?? ev ?? {})
        }
      }

      if (!sentFinal) {
        // If stream ended without a finish event, try to get result
        try {
          finalResult = (await (stream as any).result) ?? finalResult
        } catch { }

        const out = normalizeResult(finalResult, threadId || "", resourceId || "ai:general-chat", textBuffer)
        sseEvent(res, "summary", { reply: out.reply || textBuffer })
        sseEvent(res, "result", out)
        sseEvent(res, "end", { done: true })
      }

      res.end()
      return

    } catch (err: any) {
      console.error("[stream] Workflow error:", err)
      // Fallback or error response
      const msg = err?.message || "Stream failed"
      sseEvent(res, "error", { message: msg })
      sseEvent(res, "end", { done: true })
      res.end()
    }

  } catch (e: any) {
    try {
      const message = e?.message || "stream error"
      sseEvent(res, "error", { message })
      sseEvent(res, "end", { done: true })
    } finally {
      res.end()
    }
  }
}

// Helper to normalize the result shape
function normalizeResult(result: any, threadId: string, resourceId: string, textBuffer: string) {
  const base = result?.result || result?.data || result || {}
  return {
    reply: base.reply || textBuffer || "",
    toolCalls: Array.isArray(base.toolCalls) ? base.toolCalls : [],
    activations: Array.isArray(base.activations) ? base.activations : [],
    threadId: base.threadId || threadId,
    resourceId: base.resourceId || resourceId,
  }
}
