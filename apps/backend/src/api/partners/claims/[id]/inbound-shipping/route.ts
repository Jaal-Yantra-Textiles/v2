import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createReturnShippingMethodWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerOrderEntityOwnership } from "../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderEntityOwnership(req.auth_context, "claim", req.params.id, req.scope)

  const body = req.body as any
  const { result } = await createReturnShippingMethodWorkflow(req.scope).run({
    input: {
      return_id: req.params.id,
      ...body,
    },
  })

  res.json({ order_preview: result })
}
