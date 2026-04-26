import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { cancelOrderTransferRequestWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerOrderOwnership } from "../../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderOwnership(req.auth_context, req.params.id, req.scope)

  const { result } = await cancelOrderTransferRequestWorkflow(req.scope).run({
    input: {
      order_id: req.params.id,
      logged_in_user_id: req.auth_context.actor_id!,
      actor_type: "partner" as any,
    },
  })

  res.json({ order: result })
}
