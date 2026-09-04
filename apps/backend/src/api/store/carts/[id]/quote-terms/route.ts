/**
 * GET /store/carts/:id/quote-terms
 *
 * What the storefront needs in order to render a quote-bound cart honestly
 * (#1787): that its prices are held from a quote, and — when there is one —
 * that only a deposit is collected today.
 *
 * A cart minted by `acceptQuoteWorkflow` is not an ordinary basket, and neither
 * storefront said so. The buyer saw the full total on `/cart` with no mention
 * of the 30% she was actually being asked for, and the split appeared, if at
 * all, at the Review step.
 *
 * 🔴 The deposit reported here comes from `planCartCollection` — the same
 * function `ensureCartPaymentCollection` uses to decide what the payment
 * collection is created for. One pricer. A page that advertises a figure
 * computed some other way is how the promise and the charge come to disagree.
 *
 * Reads only. Safe on an ordinary cart, which gets `is_quote_cart: false` and
 * nulls throughout.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PAYMENT_SCHEDULE_MODULE } from "../../../../../modules/payment_schedule"
import { deriveQuoteCartTerms } from "./lib"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const cartId = req.params.id

  const { data: carts } = await query.graph({
    entity: "cart",
    fields: ["id", "currency_code", "total", "metadata"],
    filters: { id: cartId },
  })

  const cart = carts?.[0] as any
  if (!cart) {
    return res.status(404).json({ message: "Cart not found" })
  }

  /**
   * Best-effort. A schedule lookup that throws must not take down the cart
   * page: the derivation below reports "terms unavailable" and the storefront
   * falls back to the plain total, which is always a correct thing to show.
   */
  let schedule: any = null
  try {
    const schedules: any = req.scope.resolve(PAYMENT_SCHEDULE_MODULE)
    schedule = await schedules.findByCartId(cartId)
  } catch {
    schedule = null
  }

  return res.json({ quote_terms: deriveQuoteCartTerms(cart, schedule) })
}
