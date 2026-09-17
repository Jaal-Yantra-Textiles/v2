import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { buildCartRecoveryLink, type RecoveryLink } from "./recovery-link"

/**
 * Resolve `cart → sales channel → store → partner → storefront domain` and turn
 * it into the one link a buyer should be sent to.
 *
 * ## Why this exists separately from `recovery-link.ts`
 *
 * That file is pure and decides *which host, which country*. This one does the
 * reads that feed it. They were written together for the abandoned-cart
 * reminder (`/r/cart/:id`), and then the design-order create route needed the
 * very same answer and built its own instead:
 *
 *     STORE_URL + "/checkout/cart/" + cart.id        // one shop, no country
 *
 * 🔴 That is the wrong shop for **13 of 14 tenants** and carries no country
 * segment, so the storefront middleware substitutes `NEXT_PUBLIC_DEFAULT_REGION`
 * and re-regions the cart — the failure that put an INR buyer in front of a EUR
 * checkout (#2051). Two places answering "where does this buyer go" is how one
 * of them stays wrong, so there is now one.
 */

export type CartForLink = {
  id: string
  completed_at: string | null
  sales_channel_id: string | null
  /** ISO-2 of the cart's region, when the region names any country. */
  country_code: string | null
}

export type ResolvedCartLink = {
  /** Null when the cart could not be read at all. */
  cart: CartForLink | null
  link: RecoveryLink
}

/**
 * Where a buyer goes when we cannot name their shop. Deliberately the same
 * expression `/r/cart/:id` already used, so the two cannot drift apart.
 */
export const platformFallbackOrigin = () =>
  process.env.STORE_URL || process.env.FRONTEND_URL || "https://cicilabel.com"

/**
 * Never throws: a lookup failure returns a `null` url with a reason, because
 * every caller has something worth doing without a link (redirect to the shop
 * front, or hand the operator a created order and tell them the link is
 * missing). Losing the whole response over a link is the worse outcome.
 */
export const resolveCartCheckoutLink = async (
  scope: any,
  cartId: string
): Promise<ResolvedCartLink> => {
  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)
  const query: any = scope.resolve(ContainerRegistrationKeys.QUERY)

  let cart: CartForLink | null = null
  try {
    const { data } = await query.graph({
      entity: "cart",
      fields: ["id", "completed_at", "sales_channel_id", "region.countries.iso_2"],
      filters: { id: cartId },
    })
    const row: any = data?.[0] ?? null
    if (row) {
      cart = {
        id: row.id,
        completed_at: row.completed_at ?? null,
        sales_channel_id: row.sales_channel_id ?? null,
        country_code: row?.region?.countries?.[0]?.iso_2 ?? null,
      }
    }
  } catch (e: any) {
    logger?.warn?.(`[cart-link] cart lookup failed for ${cartId}: ${e?.message ?? e}`)
  }

  // cart → store → partner. The same hop `resolvePartnerConnect` uses.
  let partner: any = null
  try {
    if (cart?.sales_channel_id) {
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
      `[cart-link] partner lookup failed for cart ${cartId}: ${e?.message ?? e}`
    )
  }

  const link = buildCartRecoveryLink({
    cart_id: cartId,
    partner,
    country_code: cart?.country_code ?? null,
    fallback_origin: platformFallbackOrigin(),
    fallback_country: process.env.NEXT_PUBLIC_DEFAULT_REGION || null,
  })

  return { cart, link }
}
