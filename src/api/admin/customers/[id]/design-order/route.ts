import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createDraftOrderFromDesignsWorkflow } from "../../../../../workflows/designs/create-draft-order-from-designs"

type CreateDesignOrderBody = {
  design_ids: string[]
  currency_code?: string
  price_overrides?: Record<string, number>
}

export const POST = async (
  req: MedusaRequest<CreateDesignOrderBody>,
  res: MedusaResponse
) => {
  const { id: customer_id } = req.params
  const { design_ids, currency_code, price_overrides } = req.validatedBody as CreateDesignOrderBody

  const { result: order } = await createDraftOrderFromDesignsWorkflow(
    req.scope
  ).run({
    input: {
      customer_id,
      design_ids,
      currency_code,
      price_overrides,
    },
  })

  res.json({ order })
}
