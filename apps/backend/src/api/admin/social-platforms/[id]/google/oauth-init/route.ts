import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { initGoogleOauthWorkflow } from "../../../../../../workflows/google/init-oauth"
import type { GoogleService } from "../../../../../../modules/social-provider/google-connection-service"

type Body = {
  services?: GoogleService[]
  login_hint?: string
}

export const POST = async (req: MedusaRequest<Body>, res: MedusaResponse) => {
  const body = (req.body || {}) as Body

  const { result } = await initGoogleOauthWorkflow(req.scope).run({
    input: {
      platform_id: req.params.id,
      services: body.services,
      login_hint: body.login_hint,
    },
  })

  res.status(200).json(result)
}
