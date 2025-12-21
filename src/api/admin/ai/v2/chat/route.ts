import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { v4 as uuidv4 } from "uuid"
import { mastra, mastraStorageInit } from "../../../../../mastra"
import { runStorage } from "../../../../../mastra/run-storage"
import type AiV2Service from "../../../../../modules/aivtwo/service"
import { AdminAiV2ChatReq, AdminAiV2ChatReqType } from "./validators"
import { AI_VTWO_MODULE } from "../../../../../modules/aivtwo"

export const POST = async (req: MedusaRequest<AdminAiV2ChatReqType>, res: MedusaResponse) => {
  let runId = ""
  try {
    const parsed = AdminAiV2ChatReq.safeParse(
      (req as any).validatedBody || (req.body as AdminAiV2ChatReqType)
    )

    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => e.message).join(", ")
      throw new MedusaError(MedusaError.Types.INVALID_DATA, message || "Invalid request body")
    }

    await mastraStorageInit

    const wf = mastra.getWorkflow("aiV2Workflow")
    if (!wf || !(wf as any).createRunAsync) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "aiV2Workflow not found")
    }

    const body = parsed.data
    runId = uuidv4()
    const run = await (wf as any).createRunAsync({ runId })

    const aiV2Service: AiV2Service = req.scope.resolve(AI_VTWO_MODULE)

    try {
      const existing = (await (aiV2Service as any).listAiV2Runs({ run_id: runId }))?.[0]
      if (existing?.id) {
        await (aiV2Service as any).updateAiV2Runs({
          selector: { id: existing.id },
          data: {
            status: "running",
            message: body.message,
            thread_id: body.threadId,
            resource_id: body.resourceId || "ai:v2",
          },
        })
      } else {
        await (aiV2Service as any).createAiV2Runs({
          run_id: runId,
          status: "running",
          message: body.message,
          thread_id: body.threadId,
          resource_id: body.resourceId || "ai:v2",
          metadata: {},
        })
      }
    } catch {}

    const result = await run.start({
      inputData: {
        message: body.message,
        threadId: body.threadId,
        resourceId: body.resourceId || "ai:v2",
        context: {
          ...(body.context || {}),
          auth_headers: {
            authorization: req.headers.authorization,
            cookie: req.headers.cookie,
          },
        },
      },
    })

    if (result?.status === "suspended") {
      runStorage.set(runId, run)
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
              metadata: {
                suspendPayload,
              },
            },
          })
        }
      } catch {}

      return res.json({
        status: "suspended",
        runId,
        suspendPayload,
        result: (result as any)?.steps?.[stepId]?.output,
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
    }

    return res.json({
      status: "completed",
      runId,
      result: (result as any)?.result ?? (result as any)?.state?.[0]?.output ?? result,
    })
  } catch (e: any) {
    try {
      const aiV2Service: AiV2Service = req.scope.resolve(AI_VTWO_MODULE)
      if (runId) {
        const existing = (await (aiV2Service as any).listAiV2Runs({ run_id: runId }))?.[0]
        if (existing?.id) {
          await (aiV2Service as any).updateAiV2Runs({
            selector: { id: existing.id },
            data: { status: "error" },
          })
        }
      }
    } catch {}
    if (e instanceof MedusaError) {
      const status = e.type === MedusaError.Types.INVALID_DATA ? 400 : 500
      return res.status(status).json({ message: e.message })
    }
    return res.status(500).json({ message: e?.message || "Unexpected error" })
  }
}
