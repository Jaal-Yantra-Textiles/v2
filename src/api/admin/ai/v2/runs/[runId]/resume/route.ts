import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { mastraStorageInit } from "../../../../../../../mastra"
import { runStorage } from "../../../../../../../mastra/run-storage"
import { AI_VTWO_MODULE } from "../../../../../../../modules/aivtwo"
import type AiV2Service from "../../../../../../../modules/aivtwo/service"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { runId } = req.params
  const body = ((req as any).validatedBody || req.body || {}) as { step?: string; resumeData?: any }
  const { step, resumeData } = body

  try {
    const storageReady = await mastraStorageInit
    if (!storageReady) {
      return res.status(500).json({
        message:
          "Mastra storage is not initialized. Snapshots are required for suspend/resume. Set a valid DATABASE_URL/MASTRA_DATABASE_URL.",
      })
    }

    const run = runStorage.get(runId)
    if (!run) {
      return res.status(404).json({ message: "Run not found or expired" })
    }

    const aiV2Service: AiV2Service = req.scope.resolve(AI_VTWO_MODULE)

    try {
      const existing = (await (aiV2Service as any).listAiV2Runs({ run_id: runId }))?.[0]
      if (existing?.id) {
        await (aiV2Service as any).updateAiV2Runs({
          selector: { id: existing.id },
          data: { status: "running" },
        })
      }
    } catch {
      // ignore
    }

    const result = await run.resume({
      step: step || "aiv2:run",
      resumeData: {
        ...(resumeData || {}),
        context: {
          ...((resumeData as any)?.context || {}),
          auth_headers: {
            authorization: req.headers.authorization,
            cookie: req.headers.cookie,
          },
        },
      },
    })

    if (result.status === "suspended") {
      const suspendedFirst = (result as any).suspended?.[0]
      const stepId = typeof suspendedFirst === "string" ? suspendedFirst : suspendedFirst?.stepId
      const suspendPayload = stepId ? (result as any).steps?.[stepId]?.suspendPayload : null

      try {
        const existing = (await (aiV2Service as any).listAiV2Runs({ run_id: runId }))?.[0]
        if (existing?.id) {
          await (aiV2Service as any).updateAiV2Runs({
            selector: { id: existing.id },
            data: {
              status: "suspended",
              steps: (result as any)?.steps || null,
              metadata: suspendPayload ? { suspendPayload } : {},
            },
          })
        }
      } catch {
        // ignore
      }

      return res.json({
        status: "suspended",
        runId,
        stepId,
        suspendPayload,
        message: "Workflow paused again for user input",
      })
    }

    runStorage.delete(runId)

    try {
      const out = (result as any)?.result ?? (result as any)?.state?.[0]?.output ?? result
      const existing = (await (aiV2Service as any).listAiV2Runs({ run_id: runId }))?.[0]
      if (existing?.id) {
        await (aiV2Service as any).updateAiV2Runs({
          selector: { id: existing.id },
          data: {
            status: "completed",
            reply: out?.reply ?? null,
            steps: out?.steps ?? null,
            metadata: out?.suspendPayload ? { suspendPayload: out.suspendPayload } : {},
          },
        })
      }
    } catch {
      // ignore
    }

    return res.json({
      status: "completed",
      runId,
      result: (result as any)?.result ?? (result as any)?.state?.[0]?.output ?? result,
    })
  } catch (error: any) {
    try {
      const aiV2Service: AiV2Service = req.scope.resolve(AI_VTWO_MODULE)
      const existing = (await (aiV2Service as any).listAiV2Runs({ run_id: runId }))?.[0]
      if (existing?.id) {
        await (aiV2Service as any).updateAiV2Runs({
          selector: { id: existing.id },
          data: { status: "error" },
        })
      }
    } catch {
      // ignore
    }
    return res.status(500).json({ message: error?.message || "Workflow resume failed" })
  }
}
