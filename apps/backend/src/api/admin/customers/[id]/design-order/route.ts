import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { createDraftOrderFromDesignsWorkflow } from "../../../../../workflows/designs/create-draft-order-from-designs"
import designLineItemLink from "../../../../../links/design-line-item-link"

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

  // Prevent duplicate: check if any of these designs already have a pending cart
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
  try {
    const { data: existingLinks } = await query.graph({
      entity: designLineItemLink.entryPoint,
      filters: { design_id: design_ids },
      fields: ["design_id", "line_item_id"],
    })

    if (existingLinks?.length) {
      const alreadyLinkedIds = [...new Set(existingLinks.map((l: any) => l.design_id))] as string[]
      throw new MedusaError(
        MedusaError.Types.DUPLICATE_ERROR,
        `Designs already in checkout: ${alreadyLinkedIds.join(", ")}. Remove them from existing carts first.`
      )
    }
  } catch (e: any) {
    if (e instanceof MedusaError) throw e
    // Link table may not exist yet — safe to proceed
  }

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
