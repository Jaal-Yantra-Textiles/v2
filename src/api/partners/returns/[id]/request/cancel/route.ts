import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { cancelReturnRequestWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerOrderEntityOwnership } from "../../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderEntityOwnership(req.auth_context, "return", req.params.id, req.scope)

  const { result } = await cancelReturnRequestWorkflow(req.scope).run({
    input: {
      return_id: req.params.id,
    },
  })

  res.json({ return: result })
}
