/**
 * @file Admin AI Visual Flow Code Generation API
 * @description Provides endpoints for generating code from visual flow descriptions using AI
 * @module API/Admin/AI/VisualFlowCodegen
 */

/**
 * @typedef {Object} AdminVisualFlowCodegenRequest
 * @property {string} prompt.required - The natural language description of the desired workflow
 * @property {string[]} desiredOutputKeys.required - Array of expected output variable names
 * @property {boolean} [allowExternalPackages=false] - Whether to allow external package dependencies
 * @property {Object} [context] - Additional context for the code generation
 * @property {string} [threadId] - Conversation thread identifier
 * @property {string} [resourceId] - Resource identifier for tracking
 */

/**
 * @typedef {Object} GeneratedCodeResult
 * @property {string} code - The generated JavaScript/TypeScript code
 * @property {string[]} packages - Array of required package dependencies
 * @property {string[]} outputKeys - Array of output variable names
 * @property {string[]} notes - Additional notes or warnings
 */

/**
 * @typedef {Object} VisualFlowCodegenResponse
 * @property {string} message - Success/error message
 * @property {GeneratedCodeResult} result - The generated code and metadata
 */

/**
 * Generate code from visual flow description
 * @route POST /admin/ai/visual-flow-codegen
 * @group AI - Artificial Intelligence operations
 * @param {AdminVisualFlowCodegenRequest} request.body.required - Code generation parameters
 * @returns {VisualFlowCodegenResponse} 200 - Generated code and metadata
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 500 - Code generation failed or unexpected error
 *
 * @example request
 * POST /admin/ai/visual-flow-codegen
 * {
 *   "prompt": "Create a workflow that processes orders and sends confirmation emails",
 *   "desiredOutputKeys": ["orderProcessed", "emailSent"],
 *   "allowExternalPackages": true,
 *   "context": {
 *     "orderId": "order_12345",
 *     "customerEmail": "customer@example.com"
 *   },
 *   "threadId": "thread_abc123",
 *   "resourceId": "workflow_order_processing"
 * }
 *
 * @example response 200
 * {
 *   "message": "Code generated successfully",
 *   "result": {
 *     "code": "// Generated code for order processing workflow\nconst processOrder = async (order) => {\n  // Implementation here\n  return { orderProcessed: true, emailSent: true }\n}",
 *     "packages": ["@medusajs/framework", "nodemailer"],
 *     "outputKeys": ["orderProcessed", "emailSent"],
 *     "notes": ["Remember to configure SMTP settings for email functionality"]
 *   }
 * }
 *
 * @example response 200 (CI/Test bypass)
 * {
 *   "message": "Code generated successfully (bypass)",
 *   "result": {
 *     "code": "// AI bypass: deterministic stub\nconst input = $last || {}\nreturn { ok: true, input }",
 *     "packages": [],
 *     "outputKeys": ["ok", "input"],
 *     "notes": ["MASTRA_BYPASS/CI/TEST enabled - returning stub"]
 *   }
 * }
 *
 * @example response 400
 * {
 *   "message": "Invalid request body: prompt is required, desiredOutputKeys must be an array"
 * }
 *
 * @example response 500
 * {
 *   "message": "visualFlowCodegenWorkflow is not available"
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { mastra } from "../../../../mastra"
import {
  AdminVisualFlowCodegenReq,
  AdminVisualFlowCodegenReqType,
} from "./validators"

export const POST = async (
  req: MedusaRequest<AdminVisualFlowCodegenReqType>,
  res: MedusaResponse
) => {
  try {
    const parsed = AdminVisualFlowCodegenReq.safeParse(
      (req as any).validatedBody || (req.body as AdminVisualFlowCodegenReqType)
    )

    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => e.message).join(", ")
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        message || "Invalid request body"
      )
    }

    const body = parsed.data

    // CI/TEST bypass - deterministic output without external keys
    const isCiOrTest =
      process.env.CI === "true" ||
      process.env.NODE_ENV === "test" ||
      process.env.MASTRA_BYPASS === "true"

    if (isCiOrTest) {
      const stubCode = [
        "// AI bypass: deterministic stub",
        "const input = $last || {}",
        "return { ok: true, input }",
      ].join("\n")

      return res.status(200).json({
        message: "Code generated successfully (bypass)",
        result: {
          code: stubCode,
          packages: [],
          outputKeys: ["ok", "input"],
          notes: ["MASTRA_BYPASS/CI/TEST enabled - returning stub"],
        },
      })
    }

    const wf = mastra.getWorkflow("visualFlowCodegenWorkflow")
    if (!wf || !(wf as any).createRunAsync) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "visualFlowCodegenWorkflow is not available"
      )
    }
    const run = await (wf as any).createRunAsync()

    const result = await run.start({
      inputData: {
        prompt: body.prompt,
        desiredOutputKeys: body.desiredOutputKeys,
        allowExternalPackages: body.allowExternalPackages,
        context: {
          ...(body.context || {}),
          threadId: body.threadId,
          resourceId: body.resourceId || "ai:visual-flow-codegen",
          ui: "admin",
        },
      },
    })

    // Normalize output shape (Mastra may return direct output or nested step output)
    const out: any =
      (result as any)?.code && (result as any)?.outputKeys
        ? result
        : (result as any)?.steps?.generate?.output ||
          (result as any)?.steps?.run?.output ||
          (result as any)?.output ||
          result

    if (!out || typeof out.code !== "string") {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Code generation failed: provider returned empty response"
      )
    }

    return res.status(200).json({
      message: "Code generated successfully",
      result: {
        code: out.code,
        packages: Array.isArray(out.packages) ? out.packages : [],
        outputKeys: Array.isArray(out.outputKeys) ? out.outputKeys : [],
        notes: Array.isArray(out.notes) ? out.notes : [],
      },
    })
  } catch (e) {
    const err = e as Error
    if (e instanceof MedusaError) {
      const status = e.type === MedusaError.Types.INVALID_DATA ? 400 : 500
      return res.status(status).json({ message: err.message })
    }
    return res.status(500).json({ message: err.message || "Unexpected error" })
  }
}
