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
