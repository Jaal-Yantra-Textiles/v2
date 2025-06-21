import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { exchangeTokenWorkflow } from "../../../../../workflows/socials/exchange-token"

interface ExchangeTokenRequest {
  id: string
  code: string
  code_verifier: string
  state: string // We can add state validation later
}

export const POST = async (
  req: MedusaRequest<ExchangeTokenRequest>,
  res: MedusaResponse
) => {
  const { platform } = req.params as { platform: string }
  const { id, code, code_verifier } = req.body

  if (!id || !code || !code_verifier) {
    res
      .status(400)
      .json({ message: "Missing id, code, or code_verifier in request body" })
    return
  }

  const { result, errors } = await exchangeTokenWorkflow(req.scope).run({
    input: {
      id,
      platform,
      code,
      codeVerifier: code_verifier,
    },
  })

  if (errors?.length > 0) {
    console.warn("Workflow reported errors:", errors)
    res.status(500).json({ message: "Workflow execution failed." })
    return
  }

  // The result of the workflow is the newly created SocialPlatform
  res.status(200).json({ platform: result })
}
