import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { v4 as uuidv4 } from "uuid"
import { mastra, mastraStorageInit } from "../../../../../../mastra"
import { runStorage } from "../../../../../../mastra/run-storage"
import { AI_VTWO_MODULE } from "../../../../../../modules/aivtwo"
import type AiV2Service from "../../../../../../modules/aivtwo/service"
import {
  AdminAiV2ChatStreamQuery,
  AdminAiV2ChatStreamQueryType,
} from "../validators"

function sseEvent(res: MedusaResponse, event: string, data: any) {
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  let runId = ""
  res.setHeader("Content-Type", "text/event-stream")
  res.setHeader("Cache-Control", "no-cache, no-transform")
  res.setHeader("Connection", "keep-alive")
  ;(res as any).flushHeaders?.()

  try {
    const parsed = AdminAiV2ChatStreamQuery.safeParse(
      ((req as any).validatedQuery || req.query || {}) as AdminAiV2ChatStreamQueryType
    )

    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => e.message).join(", ")
      throw new MedusaError(MedusaError.Types.INVALID_DATA, message || "Invalid query")
    }

    await mastraStorageInit

    const wf = mastra.getWorkflow("aiV2Workflow")
    if (!wf || !(wf as any).createRunAsync) {
      throw new Error("aiV2Workflow not found or invalid")
    }

    const { message, threadId, resourceId: qResourceId, context } = parsed.data
    const resourceId = qResourceId || "ai:v2"

    const controller = new AbortController()
    ;(req as any).on?.("close", () => {
      try {
        controller.abort()
      } catch {}
    })

    runId = uuidv4()
    const run = await (wf as any).createRunAsync({ runId })

    const aiV2Service: AiV2Service = req.scope.resolve(AI_VTWO_MODULE)

    try {
      await (aiV2Service as any).createAiV2Runs({
        run_id: runId,
        status: "running",
        message,
        thread_id: threadId,
        resource_id: resourceId,
        metadata: {},
      })
    } catch {
    }

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
      signal: controller.signal,
    })

    const fullStream = (stream as any)?.fullStream || stream
    let finalResult: any = null
    let finished = false

    sseEvent(res, "run:start", { runId })

    for await (const ev of fullStream as any) {
      try {
        sseEvent(res, "raw", { type: ev?.type, payload: ev?.payload ?? ev ?? {} })
      } catch {
      }

      switch (ev?.type) {
        case "start":
        case "workflow-start":
          sseEvent(res, "step-start", ev.payload ?? {})
          break
        case "step-start":
        case "workflow-step-start":
          sseEvent(res, "step-start", ev.payload ?? {})
          break
        case "step-output":
        case "workflow-step-output":
          sseEvent(res, "step-output", ev.payload ?? {})
          break
        case "step-result":
        case "workflow-step-result":
          sseEvent(res, "step-result", ev.payload ?? {})
          break
        case "finish":
        case "workflow-finish": {
          try {
            finalResult = ev?.payload?.result ?? (await (stream as any).result) ?? null
          } catch {
            finalResult = null
          }

          const out = (finalResult as any)?.result ?? (finalResult as any)?.state?.[0]?.output ?? finalResult

          finished = true

          if (out?.suspended) {
            runStorage.set(runId, run)
            sseEvent(res, "run:suspended", { runId, suspendPayload: out?.suspendPayload })

            try {
              const existing = (await (aiV2Service as any).listAiV2Runs({ run_id: runId }))?.[0]
              if (existing?.id) {
                await (aiV2Service as any).updateAiV2Runs({
                  selector: { id: existing.id },
                  data: {
                    status: "suspended",
                    reply: out?.reply ?? null,
                    steps: out?.steps ?? null,
                    metadata: out?.suspendPayload ? { suspendPayload: out.suspendPayload } : {},
                  },
                })
              }
            } catch {
            }
          } else {
            runStorage.delete(runId)

            try {
              const existing = (await (aiV2Service as any).listAiV2Runs({ run_id: runId }))?.[0]
              if (existing?.id) {
                await (aiV2Service as any).updateAiV2Runs({
                  selector: { id: existing.id },
                  data: {
                    status: "completed",
                    reply: out?.reply ?? null,
                    steps: out?.steps ?? null,
                    metadata: {},
                  },
                })
              }
            } catch {
            }
          }

          sseEvent(res, "run:final", { runId, result: out })
          sseEvent(res, "end", { done: true })
          res.end()
          return
        }
        default:
          break
      }
    }

    if (!finished) {
      sseEvent(res, "run:error", { message: "Stream ended unexpectedly" })

      try {
        const existing = (await (aiV2Service as any).listAiV2Runs({ run_id: runId }))?.[0]
        if (existing?.id) {
          await (aiV2Service as any).updateAiV2Runs({
            selector: { id: existing.id },
            data: { status: "error" },
          })
        }
      } catch {
      }
    }
    sseEvent(res, "end", { done: true })
    res.end()
  } catch (e: any) {
    const msg = e?.message || "stream error"
    sseEvent(res, "run:error", { message: msg })

    try {
      if (runId) {
        const aiV2Service: AiV2Service = req.scope.resolve(AI_VTWO_MODULE)
        const existing = (await (aiV2Service as any).listAiV2Runs({ run_id: String(runId) }))?.[0]
        if (existing?.id) {
          await (aiV2Service as any).updateAiV2Runs({
            selector: { id: existing.id },
            data: { status: "error" },
          })
        }
      }
    } catch {
    }

    sseEvent(res, "end", { done: true })
    res.end()
  }
}
