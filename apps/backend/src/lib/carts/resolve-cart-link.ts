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


/**
 * PURE: which country segment does this buyer's checkout link carry? (#2177)
 *
 * 🔴 NEVER `region.countries[0]`. That read is unambiguous only by accident —
 * the INR and AUD regions happen to name one country each. The EUR region names
 * **31**, and row 0 is `al`, so every European buyer's link would have pointed
 * at an Albanian storefront prefix the moment a EUR order could be created. It
 * is the same shape as `stores[0]` on a 14-tenant table.
 *
 * The buyer's own country is the answer when we have it, and it is checked
 * against the region rather than trusted: a cart whose region does not contain
 * the buyer's country is in the WRONG REGION, and sending them to a prefix
 * their cart cannot serve would turn a pricing mistake into a checkout that
 * re-regions itself.
 *
 * Returns `null` rather than guessing. The caller then falls back to the
 * configured default, which is at least a decision somebody made.
 */
export type CheckoutCountryReason =
  | "buyer"
  | "sole_region_country"
  | "region_names_no_country"
  | "buyer_outside_region"
  | "ambiguous_region"

export function pickCheckoutCountry(input: {
  /** ISO-2 from the cart's shipping or billing address, when it has one. */
  buyerCountry?: string | null
  /** Every ISO-2 the cart's region names. */
  regionCountries?: (string | null | undefined)[] | null
}): { country: string | null; reason: CheckoutCountryReason } {
  const norm = (v: unknown): string | null => {
    if (typeof v !== "string") return null
    const t = v.trim().toLowerCase()
    return t ? t : null
  }

  const buyer = norm(input.buyerCountry)
  const region = (input.regionCountries ?? []).map(norm).filter(Boolean) as string[]

  if (region.length === 0) {
    return { country: null, reason: "region_names_no_country" }
  }
  if (buyer && region.includes(buyer)) {
    return { country: buyer, reason: "buyer" }
  }
  /**
   * 🔴 A buyer outside the cart's region still gets the region's country when
   * the region names exactly one.
   *
   * The cart IS in the wrong region for them — that is worth the loud reason —
   * but returning null here would make the link carry no country at all, and a
   * link with no country is precisely what lets the storefront substitute its
   * default and RE-REGION the cart. This file exists to prevent that, so the
   * wrong-region diagnosis must not create the very failure it diagnoses.
   * Naming the region's own country keeps the cart on the prices it was built
   * with; fixing which region it should have been in is a different job
   * (#2176 item 5).
   */
  if (region.length === 1) {
    return {
      country: region[0],
      reason: buyer ? "buyer_outside_region" : "sole_region_country",
    }
  }
  return {
    country: null,
    reason: buyer ? "buyer_outside_region" : "ambiguous_region",
  }
}

export type CartForLink = {
  id: string
  completed_at: string | null
  sales_channel_id: string | null
  /**
   * Carries `cancelled_at` when a design order was retired. The redeem route
   * needs it: a cancelled cart must not send a buyer back into checkout.
   */
  metadata: Record<string, unknown> | null
  /** ISO-2 of the cart's region, when the region names any country. */
  country_code: string | null
}

export type ResolvedCartLink = {
  /** Null when the cart could not be read at all. */
  cart: CartForLink | null
  link: RecoveryLink
}

/**
 * Where a buyer goes when we cannot name their shop.
 *
 * 🔴 `FRONTEND_URL` is NOT a storefront and was removed from this chain.
 *
 * It names the CORPORATE site — agreements, the blog, unsubscribe links all
 * build `jaalyantra.com` from it — while `STORE_URL` names the shop. On prod
 * `STORE_URL` is unset and `FRONTEND_URL` is `https://jaalyantra.com`, so this
 * resolved every fallback checkout link to a site that has no cart: today's
 * `/r/cart/:id` abandoned-cart recovery links already point there, and routing
 * the design-order detail route through this resolver was about to send
 * checkout links the same way.
 *
 * The literal default is the storefront and stays the last word, so an
 * environment that sets neither still gets a shop rather than a brochure.
 */
export const platformFallbackOrigin = () =>
  process.env.STORE_URL || "https://cicilabel.com"

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
      fields: [
        "id",
        "completed_at",
        // Carries `cancelled_at` — see CartForLink.
        "metadata",
        "sales_channel_id",
        "region.countries.iso_2",
        // The buyer's own country decides the prefix; the region only bounds it.
        "shipping_address.country_code",
        "billing_address.country_code",
        /**
         * 🔴 The CUSTOMER's addresses too, because a design-order cart has
         * none of its own.
         *
         * An admin creates that cart from designs; no address is collected —
         * it is gathered at checkout. So on a multi-country region the cart
         * named no country, the link fell back to the storefront default, and
         * for a EUR cart that default is a DIFFERENT REGION: the buyer would
         * land on an INR prefix holding a euro cart, which is precisely the
         * re-regioning this file exists to prevent. Observed locally as
         * "The cart names no region country and there is no fallback".
         */
        "customer.default_billing_address.country_code",
        "customer.default_shipping_address.country_code",
        "customer.addresses.country_code",
      ],
      filters: { id: cartId },
    })
    const row: any = data?.[0] ?? null
    if (row) {
      /**
       * Cart address first — it is about THIS order. The customer's stored
       * address is the fallback, and it is read with the same preference
       * (default billing, then default shipping, then a single address) the
       * admin wizard uses to suggest a currency, so the link and the price
       * cannot disagree about where the buyer is.
       */
      const customerCountry =
        row?.customer?.default_billing_address?.country_code ??
        row?.customer?.default_shipping_address?.country_code ??
        (() => {
          const all = (row?.customer?.addresses ?? [])
            .map((a: any) => String(a?.country_code ?? "").trim().toLowerCase())
            .filter(Boolean)
          const distinct = Array.from(new Set(all))
          // One address, or several that agree. Never `addresses[0]`.
          return distinct.length === 1 ? distinct[0] : null
        })()

      const picked = pickCheckoutCountry({
        buyerCountry:
          row?.shipping_address?.country_code ??
          row?.billing_address?.country_code ??
          customerCountry ??
          null,
        regionCountries: (row?.region?.countries ?? []).map((c: any) => c?.iso_2),
      })
      if (!picked.country) {
        // Said out loud: a link with no country segment is the case that lets
        // the storefront substitute its default and re-region the cart, which
        // is the whole failure this file exists to prevent.
        logger?.warn?.(
          `[cart-link] no confident country for cart ${cartId} (${picked.reason}) — falling back to the configured default`
        )
      }
      cart = {
        id: row.id,
        completed_at: row.completed_at ?? null,
        metadata: (row.metadata ?? null) as Record<string, unknown> | null,
        sales_channel_id: row.sales_channel_id ?? null,
        country_code: picked.country,
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
