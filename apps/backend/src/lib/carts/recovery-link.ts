/**
 * Where an abandoned-cart recovery link should actually send a buyer.
 *
 * ## The problem it fixes
 *
 * The recovery flow builds one link for the whole platform:
 *
 *     cart_url: STORE_URL + "/checkout/cart/" + cart.id   // cicilabel.com
 *
 * On a multi-tenant platform that is the wrong shop for every partner's buyer,
 * and it carries **no country segment**, so the storefront middleware fills in
 * `NEXT_PUBLIC_DEFAULT_REGION` and hands an AUD cart to an India/INR checkout —
 * wrong payment providers, and an address form whose region-scoped country
 * select silently refuses to submit.
 *
 * ## Why the resolution lives here and not in the flow
 *
 * The flow's body is sandboxed JavaScript stored in a database row. Resolving
 * `cart → sales channel → store → partner → storefront domain` inside it would
 * mean another read node and untyped, untested string handling on a live row.
 * Instead the mail carries ONE backend URL and this decides where it goes, in
 * code that typechecks and has tests.
 *
 * Pure: the two decisions — which host, which country — are made here.
 */

export type RecoveryLinkInput = {
  cart_id: string
  /** `partner.storefront_domain`, and `custom_domain` when it is verified. */
  partner?: {
    storefront_domain?: string | null
    custom_domain?: string | null
    custom_domain_verified?: boolean | null
  } | null
  /** ISO-2 of the cart's region, lower-cased by the caller or here. */
  country_code?: string | null
  /** Where to send a buyer when the partner has no storefront of their own. */
  fallback_origin?: string | null
  /** Region default, used only when the cart names no country. */
  fallback_country?: string | null
}

export type RecoveryLink = {
  url: string | null
  /** `partner` | `fallback` — which host was used, for the log line. */
  host_source: "partner" | "fallback" | "none"
  /** `cart` | `fallback` — where the country segment came from. */
  country_source: "cart" | "fallback" | "none"
  reason: string
}

const normaliseOrigin = (raw: unknown): string | null => {
  const clean = String(raw ?? "").trim().toLowerCase()
  if (!clean) return null
  const withScheme =
    clean.startsWith("http://") || clean.startsWith("https://")
      ? clean
      : `https://${clean}`
  return withScheme.replace(/\/+$/, "")
}

/**
 * The partner's own shop, when they have one.
 *
 * Mirrors `producerStorefrontUrl` deliberately: a verified custom domain wins,
 * else the provisioned subdomain. Two functions deciding "which host is this
 * partner's" must not disagree, or a buyer gets one domain in a quote and
 * another in a reminder.
 */
export const partnerStorefrontOrigin = (
  partner: RecoveryLinkInput["partner"]
): string | null => {
  const provisioned = String(partner?.storefront_domain ?? "").trim()
  if (!provisioned) return null

  const host = partner?.custom_domain_verified
    ? partner?.custom_domain || provisioned
    : provisioned

  return normaliseOrigin(host)
}

export const buildCartRecoveryLink = (
  input: RecoveryLinkInput
): RecoveryLink => {
  const cartId = String(input.cart_id ?? "").trim()
  if (!cartId) {
    return {
      url: null,
      host_source: "none",
      country_source: "none",
      reason: "No cart id, so no link can be built.",
    }
  }

  const partnerOrigin = partnerStorefrontOrigin(input.partner)
  const fallbackOrigin = normaliseOrigin(input.fallback_origin)
  const origin = partnerOrigin ?? fallbackOrigin

  if (!origin) {
    return {
      url: null,
      host_source: "none",
      country_source: "none",
      reason:
        "Neither the partner nor the platform names a storefront host, so a link would 404. Refusing to build one.",
    }
  }

  const cartCountry = String(input.country_code ?? "").trim().toLowerCase()
  const fallbackCountry = String(input.fallback_country ?? "").trim().toLowerCase()
  const country = cartCountry || fallbackCountry

  /**
   * 🔴 No country, no link. The storefront routes every page under
   * `/[countryCode]`; without one the middleware substitutes the DEFAULT
   * region, which is exactly the bug this exists to stop. A missing link is
   * recoverable — a link that quietly re-regions the buyer's cart is not.
   */
  if (!country) {
    return {
      url: null,
      host_source: partnerOrigin ? "partner" : "fallback",
      country_source: "none",
      reason:
        "The cart names no region country and there is no fallback, so any link would be re-regioned to the storefront default.",
    }
  }

  return {
    url: `${origin}/${country}/checkout/cart/${cartId}`,
    host_source: partnerOrigin ? "partner" : "fallback",
    country_source: cartCountry ? "cart" : "fallback",
    reason: partnerOrigin
      ? `Sending the buyer to the partner's own storefront under /${country}.`
      : `The partner has no storefront of their own; using the platform host under /${country}.`,
  }
}
