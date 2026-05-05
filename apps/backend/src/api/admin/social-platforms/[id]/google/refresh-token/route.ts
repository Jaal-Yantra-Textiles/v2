import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { refreshGoogleTokenWorkflow } from "../../../../../../workflows/google/refresh-token"

type Body = { force?: boolean }

export const POST = async (req: MedusaRequest<Body>, res: MedusaResponse) => {
  const body = (req.body || {}) as Body

  const { result } = await refreshGoogleTokenWorkflow(req.scope).run({
    input: {
      platform_id: req.params.id,
      force: body.force === true,
    },
  })

  res.status(200).json(result)
}
