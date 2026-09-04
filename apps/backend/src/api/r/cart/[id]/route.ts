import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { buildCartRecoveryLink } from "../../../../lib/carts/recovery-link"

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
 * here in code that typechecks and has tests.
 *
 * Public and unauthenticated, like the payment links: the cart id is the
 * credential, and it is a ULID.
 */
const FALLBACK_ORIGIN = () =>
  process.env.STORE_URL || process.env.FRONTEND_URL || "https://cicilabel.com"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const cartId = req.params.id

  let cart: any = null
  try {
    const { data } = await query.graph({
      entity: "cart",
      fields: [
        "id",
        "completed_at",
        "sales_channel_id",
        "region.countries.iso_2",
      ],
      filters: { id: cartId },
    })
    cart = data?.[0] ?? null
  } catch (e: any) {
    logger?.warn?.(`[cart-recovery] cart lookup failed for ${cartId}: ${e?.message ?? e}`)
  }

  /**
   * An unknown cart goes to the platform's front page rather than a 404 page.
   * The person clicking is a customer holding an old email, not a developer —
   * and a shop front is a better answer than an error.
   */
  if (!cart) {
    return res.redirect(302, FALLBACK_ORIGIN())
  }

  /**
   * A completed cart means they already bought. Sending them back into a
   * checkout for it invites a second order.
   */
  if (cart.completed_at) {
    return res.redirect(302, FALLBACK_ORIGIN())
  }

  // cart → store → partner. The same hop `resolvePartnerConnect` uses.
  let partner: any = null
  try {
    if (cart.sales_channel_id) {
      const { data: stores } = await query.graph({
        entity: "store",
        filters: { default_sales_channel_id: cart.sales_channel_id },
        fields: [
          "id",
          "partner.id",
          "partner.storefront_domain",
          "partner.custom_domain",
          "partner.custom_domain_verified",
        ],
      })
      partner = (stores?.[0] as any)?.partner ?? null
    }
  } catch (e: any) {
    logger?.warn?.(
      `[cart-recovery] partner lookup failed for cart ${cartId}: ${e?.message ?? e}`
    )
  }

  const link = buildCartRecoveryLink({
    cart_id: cartId,
    partner,
    country_code: cart?.region?.countries?.[0]?.iso_2 ?? null,
    fallback_origin: FALLBACK_ORIGIN(),
    fallback_country: process.env.NEXT_PUBLIC_DEFAULT_REGION || null,
  })

  if (!link.url) {
    logger?.warn?.(
      `[cart-recovery] no link for cart ${cartId}: ${link.reason}`
    )
    return res.redirect(302, FALLBACK_ORIGIN())
  }

  logger?.info?.(
    `[cart-recovery] cart=${cartId} → ${link.host_source} host, ${link.country_source} country`
  )

  return res.redirect(302, link.url)
}
