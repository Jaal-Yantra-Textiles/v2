import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { orderClaimRequestItemReturnWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerOrderEntityOwnership } from "../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderEntityOwnership(req.auth_context, "claim", req.params.id, req.scope)

  const body = req.body as any
  const { result } = await orderClaimRequestItemReturnWorkflow(req.scope).run({
    input: {
      claim_id: req.params.id,
      ...body,
    },
  })

  res.json({ order_preview: result })
}
