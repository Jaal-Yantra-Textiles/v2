/**
 * GET /store/carts/:id/checkout-status
 *
 * Lightweight poll for whether a cart has become an order. Used by the MCP
 * get_checkout_status tool after a shopper pays on a hosted page (Stripe or
 * PayU link), since the cart is completed asynchronously by the payment webhook.
 *
 * Resolves the order via the `order_cart` link (Medusa's order↔cart relation is
 * a link, not a queryable `order.cart_id` column) and falls back to the cart's
 * own `completed_at`.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { deriveCheckoutStatus } from "./lib"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const cartId = req.params.id

  const { data: carts } = await query.graph({
    entity: "cart",
    fields: ["id", "completed_at"],
    filters: { id: cartId },
  })
  const cart = carts?.[0] as any
  if (!cart) {
    return res.status(404).json({ message: "Cart not found" })
  }

  let orderId: string | null = null
  try {
    const { data: links } = await query.graph({
      entity: "order_cart",
      fields: ["order_id"],
      filters: { cart_id: cartId },
    })
    orderId = (links?.[0] as any)?.order_id ?? null
  } catch {
    // order_cart link not resolvable yet — fall back to completed_at below.
  }

  return res.json(deriveCheckoutStatus(cart, orderId))
}
