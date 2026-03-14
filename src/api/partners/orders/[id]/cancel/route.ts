import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { cancelOrderWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerOrderOwnership } from "../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderOwnership(req.auth_context, req.params.id, req.scope)

  await cancelOrderWorkflow(req.scope).run({
    input: { order_id: req.params.id },
  })

  res.json({ order: { id: req.params.id, status: "canceled" } })
}
