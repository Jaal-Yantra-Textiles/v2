import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { updateClaimItemWorkflow, removeItemClaimActionWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerOrderEntityOwnership } from "../../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderEntityOwnership(req.auth_context, "claim", req.params.id, req.scope)

  const body = req.body as any
  const { result } = await updateClaimItemWorkflow(req.scope).run({
    input: {
      claim_id: req.params.id,
      action_id: req.params.actionId,
      data: body,
    },
  })

  res.json({ order_preview: result })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderEntityOwnership(req.auth_context, "claim", req.params.id, req.scope)

  const { result } = await removeItemClaimActionWorkflow(req.scope).run({
    input: {
      claim_id: req.params.id,
      action_id: req.params.actionId,
    },
  })

  res.json({ order_preview: result })
}
