/**
 * @file Admin API routes for AI Chat
 *
 * Uses the Hybrid Query Resolver for:
 * - BM25 code search + LLM for query understanding
 * - Pre-indexed docs for fast common queries
 * - Simplified 5-step workflow vs V3's 12 steps
 * - Human-in-the-loop clarification for ambiguous queries
 *
 * @route POST /admin/ai/chat/chat
 */

import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { v4 as uuidv4 } from "uuid"
import { mastra, mastraStorageInit } from "../../../../../mastra"
import { AdminAiV4ChatReq, AdminAiV4ChatReqType } from "./validators"

/**
 * POST /admin/ai/chat/chat
 *
 * Process an AI chat request using the V4 hybrid resolver workflow.
 *
 * Supports human-in-the-loop clarification when queries are ambiguous.
 * When clarification is needed, returns `needsClarification: true` with options.
 * User can then send another request with `clarification` context to continue.
 *
 * @example request (initial)
 * POST /admin/ai/chat/chat
 * {
 *   "message": "show me campaigns",
 *   "threadId": "thread_123"
 * }
 *
 * @example response (clarification needed)
 * {
 *   "status": "clarification_needed",
 *   "result": {
 *     "reply": "I found multiple types of campaigns...",
 *     "needsClarification": true,
 *     "clarificationOptions": [
 *       { "id": "publishing_campaigns", "label": "Publishing Campaigns", ... },
 *       { "id": "meta_ads_campaigns", "label": "Meta Ads Campaigns", ... }
 *     ]
 *   }
 * }
 *
 * @example request (with clarification)
 * POST /admin/ai/chat/chat
 * {
 *   "message": "show me campaigns",
 *   "clarification": {
 *     "selectedOptionId": "publishing_campaigns",
 *     "selectedModule": "publishing_campaigns",
 *     "originalQuery": "show me campaigns"
 *   }
 * }
 *
 * @example response (completed)
 * {
 *   "status": "completed",
 *   "result": {
 *     "reply": "Here are your publishing campaigns...",
 *     "mode": "data"
 *   }
 * }
 */
export const POST = async (req: MedusaRequest<AdminAiV4ChatReqType>, res: MedusaResponse) => {
  const runId = uuidv4()

  try {
    // Validate request body
    const parsed = AdminAiV4ChatReq.safeParse(
      (req as any).validatedBody || (req.body as AdminAiV4ChatReqType)
    )

    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => e.message).join(", ")
      throw new MedusaError(MedusaError.Types.INVALID_DATA, message || "Invalid request body")
    }

    // Ensure Mastra storage is initialized
    await mastraStorageInit

    // Get the V4 workflow
    const wf = mastra.getWorkflow("aiChatWorkflow")
    if (!wf || !(wf as any).createRunAsync) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "aiChatWorkflow not found")
    }

    const body = parsed.data

    // Create and start the workflow run
    const run = await (wf as any).createRunAsync({ runId })

    const startTime = Date.now()

    const result = await run.start({
      inputData: {
        message: body.message,
        threadId: body.threadId || `thread_${Date.now()}`,
        resourceId: body.resourceId || "ai:v4",
        // Pass clarification context if user selected an option
        clarification: body.clarification,
        context: {
          // Pass container reference for service calls
          container: req.scope,
          // Pass auth headers for authenticated service calls
          auth_headers: {
            authorization: req.headers.authorization,
            cookie: req.headers.cookie,
          },
        },
      },
      // Pass container reference for step execution
      mapiContainerRef: { deref: () => req.scope },
    })

    const durationMs = Date.now() - startTime

    // Extract the result from workflow output
    const output = (result as any)?.result ?? (result as any)?.state?.[0]?.output ?? result

    // Check if clarification is needed (human-in-the-loop)
    if (output?.needsClarification) {
      return res.json({
        status: "clarification_needed",
        runId,
        result: {
          reply: output.reply,
          mode: "clarification",
          threadId: output.threadId,
          // Clarification fields for UI to render options
          needsClarification: true,
          clarificationMessage: output.clarificationMessage,
          clarificationOptions: output.clarificationOptions,
        },
        meta: {
          durationMs,
          version: "v4",
        },
      })
    }

    return res.json({
      status: "completed",
      runId,
      result: {
        reply: output?.reply,
        steps: output?.steps,
        mode: output?.mode,
        model: output?.model,
        threadId: output?.threadId,
        resolvedQuery: output?.resolvedQuery ? {
          targetEntity: output.resolvedQuery.targetEntity,
          mode: output.resolvedQuery.mode,
          source: output.resolvedQuery.source,
          confidence: output.resolvedQuery.confidence,
          patterns: output.resolvedQuery.patterns?.slice(0, 3),
          executionPlanSteps: output.resolvedQuery.executionPlan?.length || 0,
          executionPlan: output.resolvedQuery.executionPlan,
        } : null,
        executionLogs: output?.executionLogs,
      },
      meta: {
        durationMs,
        version: "v4",
      },
    })
  } catch (e: any) {
    if (e instanceof MedusaError) {
      const status = e.type === MedusaError.Types.INVALID_DATA ? 400 : 500
      return res.status(status).json({ message: e.message })
    }
    return res.status(500).json({
      message: e?.message || "Unexpected error",
      runId,
    })
  }
}

/**
 * GET /admin/ai/chat/chat
 *
 * Get V4 chat status and configuration info.
 */
export const GET = async (_req: MedusaRequest, res: MedusaResponse) => {
  try {
    // Check if workflow exists
    const wf = mastra.getWorkflow("aiChatWorkflow")
    const workflowAvailable = !!(wf && (wf as any).createRunAsync)

    // Check if hybrid resolver is configured
    const llmConfigured = !!process.env.OPENROUTER_API_KEY

    return res.json({
      status: "ok",
      version: "v4",
      workflow: {
        available: workflowAvailable,
        name: "aiChatWorkflow",
      },
      config: {
        llm_configured: llmConfigured,
        features: [
          "BM25 code search",
          "Pre-indexed docs lookup",
          "LLM query analysis",
          "Simplified 5-step pipeline",
          "Human-in-the-loop clarification",
        ],
      },
    })
  } catch (e: any) {
    return res.status(500).json({ message: e?.message || "Unexpected error" })
  }
}
