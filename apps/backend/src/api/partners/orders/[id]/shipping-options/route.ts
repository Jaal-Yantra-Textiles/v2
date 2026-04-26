import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { listShippingOptionsForOrderWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerOrderOwnership } from "../../../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderOwnership(req.auth_context, req.params.id, req.scope)

  const { result } = await listShippingOptionsForOrderWorkflow(req.scope).run({
    input: {
      order_id: req.params.id,
      is_return: (req.query as any)?.is_return === "true",
    },
  })

  res.json({ shipping_options: result })
}
