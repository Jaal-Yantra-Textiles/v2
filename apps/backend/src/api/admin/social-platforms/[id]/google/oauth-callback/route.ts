import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { completeGoogleOauthWorkflow } from "../../../../../../workflows/google/complete-oauth"

type Body = { code: string; state?: string }

export const POST = async (req: MedusaRequest<Body>, res: MedusaResponse) => {
  const { code, state } = (req.body || {}) as Body
  if (!code) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "code is required")
  }

  const { result } = await completeGoogleOauthWorkflow(req.scope).run({
    input: {
      platform_id: req.params.id,
      code,
      state,
    },
  })

  res.status(200).json({ platform: result, success: true, connected: true })
}
