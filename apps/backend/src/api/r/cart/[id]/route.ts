import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  platformFallbackOrigin,
  resolveCartCheckoutLink,
} from "../../../../lib/carts/resolve-cart-link"

/**
 * GET /r/cart/:id — the abandoned-cart reminder's link.
 *
 * ## Why the mail points here and not at a storefront
 *
 * The recovery flow's body is sandboxed JavaScript in a database row, and it
 * built ONE url for the whole platform:
 *
 *     STORE_URL + "/checkout/cart/" + cart.id      // cicilabel.com, no country
 *
 * On a multi-tenant platform that is the wrong shop for every partner's buyer,
 * and the missing country segment makes the storefront middleware substitute
 * `NEXT_PUBLIC_DEFAULT_REGION` — handing an AUD cart to an India/INR checkout,
 * which is how a live buyer met PayU instead of Stripe and an address form that
 * silently refused to submit.
 *
 * Resolving `cart → sales channel → store → partner → storefront domain` inside
 * that sandbox would mean another read node and untyped string handling on a
 * live flow row. So the mail carries one backend URL, and the decision is made
 * in `lib/carts/resolve-cart-link` — code that typechecks, has tests, and is
 * now shared with the design-order create route so the two cannot disagree.
 *
 * Public and unauthenticated, like the payment links: the cart id is the
 * credential, and it is a ULID.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const cartId = req.params.id

  const { cart, link } = await resolveCartCheckoutLink(req.scope, cartId)

  /**
   * An unknown cart goes to the platform's front page rather than a 404 page.
   * The person clicking is a customer holding an old email, not a developer —
   * and a shop front is a better answer than an error.
   */
  if (!cart) {
    return res.redirect(302, platformFallbackOrigin())
  }

  /**
   * A completed cart means they already bought. Sending them back into a
   * checkout for it invites a second order.
   */
  if (cart.completed_at) {
    return res.redirect(302, platformFallbackOrigin())
  }

  if (!link.url) {
    logger?.warn?.(`[cart-recovery] no link for cart ${cartId}: ${link.reason}`)
    return res.redirect(302, platformFallbackOrigin())
  }

  logger?.info?.(
    `[cart-recovery] cart=${cartId} → ${link.host_source} host, ${link.country_source} country`
  )

  return res.redirect(302, link.url)
}
