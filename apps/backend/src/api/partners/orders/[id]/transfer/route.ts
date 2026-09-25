import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { requestOrderTransferWorkflow } from "@medusajs/medusa/core-flows"
import { assertNotWorkOrder, validatePartnerOrderOwnership } from "../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderOwnership(req.auth_context, req.params.id, req.scope)
  await assertNotWorkOrder(req.params.id, req.scope)

  const body = req.body as any
  const { result } = await requestOrderTransferWorkflow(req.scope).run({
    input: {
      order_id: req.params.id,
      ...body,
    },
  })

  res.json({ order: result })
}
