import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { createDraftOrderFromDesignsWorkflow } from "../../../../workflows/designs/create-draft-order-from-designs"
import designLineItemLink from "../../../../links/design-line-item-link"
import { resolveCartCheckoutLink } from "../../../../lib/carts/resolve-cart-link"
import { createPayuLinkForCart } from "../../../../lib/payments/payu-cart-link"
import { deliverDesignOrderEmail } from "../../../../workflows/designs/deliver-design-order-email"

export type CreateDesignOrderBody = {
  design_ids: string[]
  currency_code?: string
  price_overrides?: Record<string, number>
  /** Currency of price_overrides (e.g. "inr"). Defaults to store default. */
  override_currency?: string
}

/**
 * Turn selected designs into ONE draft order — with or without a customer.
 *
 * ## Why the customer is optional
 *
 * The designs list offered "Create Order" on any selection and then refused it
 * unless every selected design already carried a customer link. On this
 * platform that is the exception, not the rule: a design only gets a customer
 * when it was made for somebody, and most are made for stock, from a brief, or
 * out of the assistant. The operator was told to "link a customer first" for an
 * order they were creating precisely because there is not one yet.
 *
 * 🔑 A cart with no customer is an ordinary thing here — a draft the buyer is
 * attached to later, at checkout or when the order is claimed. What is NOT
 * ordinary is a cart attached to the WRONG customer, which is what asking the
 * operator to pick one "to get past the dialog" would eventually produce.
 *
 * ⚠️ `email` follows the customer. Left null it is filled in at checkout; the
 * one thing never done here is inventing a placeholder address, which would put
 * an unreachable buyer on a real order.
 */
export const createDesignDraftOrder = async (
  req: MedusaRequest<CreateDesignOrderBody>,
  res: MedusaResponse,
  customer_id: string | null
) => {
  const { design_ids, currency_code, price_overrides, override_currency } =
    req.validatedBody as CreateDesignOrderBody

  // Prevent duplicate: check if any of these designs already have a pending cart
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    const { data: existingLinks } = await query.graph({
      entity: designLineItemLink.entryPoint,
      filters: { design_id: design_ids },
      fields: ["design_id", "line_item_id"],
    })

    if (existingLinks?.length) {
      const alreadyLinkedIds = [
        ...new Set(existingLinks.map((l: any) => l.design_id)),
      ] as string[]
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

  /**
   * 🔴 This was `STORE_URL + "/checkout/cart/" + cart.id` — one hardcoded shop
   * for all 14 tenants, and no country segment, so the storefront middleware
   * re-regioned the cart to `NEXT_PUBLIC_DEFAULT_REGION` (#2051's shape). The
   * resolution now lives in one place, shared with `/r/cart/:id`.
   *
   * A null url is reported, not thrown: the order exists either way, and the
   * operator needs to be told it exists even when we cannot name its shop.
   */
  const { link } = await resolveCartCheckoutLink(req.scope, cart.id)
  if (!link.url) {
    logger?.warn?.(
      `[design-order] no checkout link for cart ${cart.id}: ${link.reason}`
    )
  }

  const payu = await createPayuLinkForCart(req.scope, cart.id, {
    description: `Design order ${cart.id}`,
  })

  /**
   * Never allowed to fail the create: the cart is already committed and this
   * response is the only place the operator is shown the link. A failed send
   * comes back as a verdict the panel renders, not as a 500 that destroys it.
   */
  const email = await deliverDesignOrderEmail(req.scope, {
    cart,
    checkoutUrl: link.url,
    paymentLink: payu.payment_link,
  })

  res.json({
    cart,
    email,
    checkout_url: link.url,
    /** Why there is no checkout link. Null when there is one. */
    checkout_url_reason: link.url ? null : link.reason,
    payment_link: payu.payment_link,
    /** Why there is no payment link — non-INR is the ordinary case. */
    payment_link_reason: payu.reason,
  })
}
