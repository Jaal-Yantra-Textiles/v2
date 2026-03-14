import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { beginOrderEditOrderWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerOrderOwnership } from "../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const body = req.body as any
  await validatePartnerOrderOwnership(req.auth_context, body.order_id, req.scope)

  const { result } = await beginOrderEditOrderWorkflow(req.scope).run({
    input: {
      ...body,
      created_by: req.auth_context.actor_id,
    },
  })

  res.json({ order_change: result })
}
