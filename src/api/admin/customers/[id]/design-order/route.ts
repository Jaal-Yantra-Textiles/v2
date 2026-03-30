import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createDraftOrderFromDesignsWorkflow } from "../../../../../workflows/designs/create-draft-order-from-designs"

type CreateDesignOrderBody = {
  design_ids: string[]
  currency_code?: string
  price_overrides?: Record<string, number>
  /** Currency of price_overrides (e.g. "inr"). Defaults to store default. */
  override_currency?: string
}

export const POST = async (
  req: MedusaRequest<CreateDesignOrderBody>,
  res: MedusaResponse
) => {
  const { id: customer_id } = req.params
  const { design_ids, currency_code, price_overrides, override_currency } = req.validatedBody as CreateDesignOrderBody

  const { result: cart } = await createDraftOrderFromDesignsWorkflow(
    req.scope
  ).run({
    input: {
      customer_id,
      design_ids,
      currency_code,
      price_overrides,
      override_currency,
    },
  })

  const storeUrl = process.env.STORE_URL || "https://cicilabel.com"
  const checkoutUrl = `${storeUrl}/checkout/cart/${cart.id}`

  res.json({
    cart,
    checkout_url: checkoutUrl,
  })
}
