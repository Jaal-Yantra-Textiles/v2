/**
 * @file Admin API route for triggering multi-step HITL workflows
 * @description Provides endpoints for initiating complex AI workflows that may require human-in-the-loop intervention
 * @module API/Admin/AI/Workflows
 */

/**
 * @typedef {Object} MultiStepWorkflowInput
 * @property {string} [message] - The initial message or query to process
 * @property {string} [threadId] - Optional thread identifier for conversation context
 * @property {Object} [context] - Additional context data for the workflow
 * @property {Object} [context.auth_headers] - Authentication headers to pass through
 * @property {string} [context.auth_headers.authorization] - Authorization header
 * @property {string} [context.auth_headers.cookie] - Cookie header
 */

/**
 * @typedef {Object} WorkflowSuspendedResponse
 * @property {string} status - Always "suspended" when workflow is paused
 * @property {string} runId - Unique identifier for the workflow run
 * @property {Object} suspendPayload - Data required for resuming the workflow
 * @property {string} message - Human-readable status message
 */

/**
 * @typedef {Object} WorkflowCompletedResponse
 * @property {string} status - Always "completed" when workflow finishes
 * @property {Object} result - The output data from the workflow execution
 */

/**
 * Trigger multi-step HITL workflow for complex API requests
 * @route POST /admin/ai/workflows/multi-step
 * @group AI Workflows - Operations related to AI workflows
 * @param {MultiStepWorkflowInput} request.body.required - Workflow input data
 * @returns {WorkflowSuspendedResponse} 200 - Workflow suspended for user input
 * @returns {WorkflowCompletedResponse} 200 - Workflow completed successfully
 * @throws {MedusaError} 500 - Mastra storage not initialized
 * @throws {MedusaError} 500 - Workflow not found
 * @throws {MedusaError} 500 - Workflow execution failed
 *
 * @example request
 * POST /admin/ai/workflows/multi-step
 * {
 *   "message": "Process this complex order with special requirements",
 *   "threadId": "thread_abc123",
 *   "context": {
 *     "orderId": "order_789xyz",
 *     "customerId": "cust_456def",
 *     "auth_headers": {
 *       "authorization": "Bearer token123",
 *       "cookie": "session=abc123"
 *     }
 *   }
 * }
 *
 * @example response 200 (suspended)
 * {
 *   "status": "suspended",
 *   "runId": "run_1a2b3c4d",
 *   "suspendPayload": {
 *     "requiredAction": "human_approval",
 *     "data": {
 *       "orderId": "order_789xyz",
 *       "reason": "Special handling required"
 *     }
 *   },
 *   "message": "Workflow paused for user input"
 * }
 *
 * @example response 200 (completed)
 * {
 *   "status": "completed",
 *   "result": {
 *     "processed": true,
 *     "orderId": "order_789xyz",
 *     "actionsTaken": ["verified_address", "applied_discount"],
 *     "timestamp": "2023-11-15T14:30:00Z"
 *   }
 * }
 */
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
