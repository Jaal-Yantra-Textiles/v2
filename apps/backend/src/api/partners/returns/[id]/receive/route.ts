import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { beginReceiveReturnWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerOrderEntityOwnership } from "../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderEntityOwnership(req.auth_context, "return", req.params.id, req.scope)

  const body = req.body as any
  const { result } = await beginReceiveReturnWorkflow(req.scope).run({
    input: {
      return_id: req.params.id,
      ...body,
    },
  })

  res.json({ return: result })
}
