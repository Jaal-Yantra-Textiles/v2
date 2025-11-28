import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { oauthCallbackWorkflow } from "../../../../../workflows/socials/oauth-callback"

interface CallbackRequestBody {
  id: string
  code: string
  state?: string
  redirect_uri?: string
}

export const POST = async (
  req: MedusaRequest<CallbackRequestBody>,
  res: MedusaResponse
) => {
  const { platform } = req.params as { platform: string }
  const { id, code, state, redirect_uri } = req.body || ({} as CallbackRequestBody)

  if (!id || !code) {
    res.status(400).json({ message: "Missing id or code in request body" })
    return
  }

  try {
    // Execute OAuth callback workflow
    const { result } = await oauthCallbackWorkflow(req.scope).run({
      input: {
        platform_id: id,
        platform,
        code,
        state,
        redirect_uri,
      },
    })

    res.status(200).json(result)
  } catch (error: any) {
    req.scope.resolve("logger").error(`[OAuth Callback] Failed: ${error.message}`, error)
    res.status(500).json({ message: error.message })
  }
}
