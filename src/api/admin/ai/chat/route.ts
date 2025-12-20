import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { AdminGeneralChatReq, AdminGeneralChatReqType } from "./validators"
import { generalChatMedusaWorkflow } from "../../../../workflows/ai/general-chat"

export const POST = async (
  req: MedusaRequest<AdminGeneralChatReqType>,
  res: MedusaResponse
) => {
  try {
    // Validate input from JSON body
    const parsed = AdminGeneralChatReq.safeParse(
      (req as any).validatedBody || (req.body as AdminGeneralChatReqType)
    )

    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => e.message).join(", ")
      throw new MedusaError(MedusaError.Types.INVALID_DATA, message || "Invalid request body")
    }

    const body = parsed.data

    // CI/TEST bypass - deterministic response without external keys
    const isCiOrTest = process.env.CI === "true" || process.env.NODE_ENV === "test" || process.env.MASTRA_BYPASS === "true"
    if (isCiOrTest) {
      const reply = `You said: ${body.message}`
      return res.status(200).json({
        message: "Chat processed successfully (bypass)",
        result: {
          reply,
          toolCalls: [],
          activations: [],
          threadId: body.threadId,
          resourceId: body.resourceId || "ai:general-chat",
        },
      })
    }

    const { result, errors } = await generalChatMedusaWorkflow(req.scope).run({
      input: {
        message: body.message,
        threadId: body.threadId,
        resourceId: body.resourceId,
        context: {
          ...body.context,
          auth_headers: {
            authorization: req.headers.authorization,
            cookie: req.headers.cookie,
          }
        },
      },
    })

    if (errors.length) {
      const msg = errors.map((e) => e.error?.message).filter(Boolean).join("; ")
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, msg || "General chat workflow failed")
    }

    return res.status(200).json({
      message: "Chat processed successfully",
      result,
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
