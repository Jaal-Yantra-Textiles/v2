import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { mastra, mastraStorageInit } from "../../../../../mastra"
import { runStorage } from "../../../../../mastra/run-storage"
import { v4 as uuidv4 } from "uuid"

/**
 * POST /admin/ai/workflows/multi-step
 * 
 * Trigger multi-step HITL workflow for complex API requests
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
    const { message, threadId, context } = req.body as { message?: string; threadId?: string; context?: any }

    try {
        const storageReady = await mastraStorageInit
        if (!storageReady) {
            return res.status(500).json({
                message: "Mastra storage is not initialized. Snapshots are required for suspend/resume. Set a valid DATABASE_URL/MASTRA_DATABASE_URL.",
            })
        }

        // Get workflow from Mastra
        const workflow = mastra.getWorkflow("multiStepApiRequestWorkflow")

        if (!workflow) {
            return res.status(500).json({
                message: "Workflow not found. Ensure workflow is registered with Mastra.",
            })
        }

        // Create a new run
        const runId = uuidv4()
        const run = await workflow.createRunAsync({ runId })

        // Store run instance for later resume
        runStorage.set(runId, run)

        // Start the workflow
        const result = await run.start({
            inputData: {
                message: message || "",
                threadId,
                context: {
                    ...(context || {}),
                    auth_headers: {
                        authorization: req.headers.authorization,
                        cookie: req.headers.cookie,
                    },
                },
            },
        })

        // If workflow suspended, return suspension info
        if (result.status === "suspended") {
            const suspendedFirst = (result as any).suspended?.[0]
            const stepId = typeof suspendedFirst === "string" ? suspendedFirst : suspendedFirst?.stepId
            const suspendPayload = stepId ? (result as any).steps?.[stepId]?.suspendPayload : null

            return res.json({
                status: "suspended",
                runId,
                suspendPayload,
                message: "Workflow paused for user input",
            })
        }

        // Workflow completed immediately (no suspension)
        runStorage.delete(runId)

        return res.json({
            status: "completed",
            result: result.state?.[0]?.output,
        })
    } catch (error: any) {
        console.error("[HITL Trigger] Error:", error)
        return res.status(500).json({
            message: error?.message || "Workflow execution failed",
        })
    }
}
