import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { producerStorefrontUrl } from "./quote-producer"

/**
 * Where the buyer's quote lives (#1420).
 *
 * ## Why this is server-side, and why it is here
 *
 * The link was composed in the UI — twice. `minted-panel.tsx` (admin) and
 * `quote-minted-panel.tsx` (partner) each built
 * `https://<host>/<cc>/quotes/<token>` from whatever object was to hand, and
 * they did not agree:
 *
 * - The partner panel read the host off the PARTNER, which has those columns.
 * - The admin panel read it off the QUOTE, which has neither `storefront_domain`
 *   nor `custom_domain`. Both were always `undefined`, so an admin mint has
 *   never produced a buyer link at all — only a bare token.
 * - Both preferred `custom_domain` with no regard for `custom_domain_verified`,
 *   which points a buyer at a host we do not control.
 *
 * The email needs the same link, and an email built from a third copy of this
 * rule is how the three quietly diverge. So the server composes it once, the
 * mint response carries it, and no client assembles a URL again.
 *
 * 🔑 The host rule is NOT re-implemented here — `producerStorefrontUrl` already
 * owns "which host is this partner reachable on", including the refusal to link
 * an unverified custom domain, and it is already under test.
 *
 * ## The house fallback
 *
 * A quote minted by an admin for a partner with no domain — and, once #1486's
 * no-partner branch lands, a house quote with no partner at all — has no
 * partner host to use. It falls back to the platform storefront, from
 * `ROOT_DOMAIN` (cicilabel.com) with `FRONTEND_URL` as the second choice.
 *
 * 🔑 The fallback is the LAST resort, never the first. A partner's buyer must
 * land on the partner's own shop: the quote page names the producer, prices
 * against their catalogue and, once accepted, builds a cart in their sales
 * channel. Preferring the house domain would quietly move every partner's
 * buyer onto ours.
 */

/**
 * PURE: the buyer URL, or null when any part of it is missing.
 *
 * Null rather than a partial URL. A link missing its country segment 404s on
 * the storefront, and a 404 that looks like a link is worse than an honest
 * absence — especially here, where the link is the only copy of the token.
 */
export function buildQuoteBuyerUrl(input: {
  origin: string | null | undefined
  countryCode: string | null | undefined
  token: string | null | undefined
}): string | null {
  const origin = String(input.origin ?? "").trim().replace(/\/+$/, "")
  const country = String(input.countryCode ?? "").trim().toLowerCase()
  const token = String(input.token ?? "").trim()

  if (!origin || !country || !token) return null

  // The storefront routes every page under /[countryCode]; a link without that
  // segment 404s. The country comes from the quote's own destination.
  return `${origin}/${country}/quotes/${token}`
}

/**
 * Resolve the buyer link for a freshly minted quote.
 *
 * Never throws: a mint that already created a live price list must not be
 * turned into a 500 by a failed domain lookup. A null link is recoverable — the
 * caller still holds the token — and is reported rather than swallowed.
 */
export function houseStorefrontOrigin(
  env: Record<string, string | undefined> = process.env
): string | null {
  // A bare host in ROOT_DOMAIN; a full URL in FRONTEND_URL. Both are handled,
  // because both are what is actually in the environment.
  const root = String(env.ROOT_DOMAIN ?? "").trim().toLowerCase()
  if (root) {
    return root.startsWith("http://") || root.startsWith("https://")
      ? root
      : `https://${root}`
  }

  const frontend = String(env.FRONTEND_URL ?? "").trim().toLowerCase()
  if (frontend) {
    return frontend.startsWith("http") ? frontend : `https://${frontend}`
  }

  return null
}

export async function resolveQuoteBuyerLink(
  scope: any,
  input: {
    partner_id: string | null | undefined
    destination_country_code: string | null | undefined
    token: string | null | undefined
  }
): Promise<string | null> {
  if (!input.token) return null

  const houseLink = () =>
    buildQuoteBuyerUrl({
      origin: houseStorefrontOrigin(),
      countryCode: input.destination_country_code,
      token: input.token,
    })

  // No partner at all — a house quote. Nothing to look up.
  if (!input.partner_id) return houseLink()

  try {
    const query: any = scope.resolve(ContainerRegistrationKeys.QUERY)
    // Filtered by id, always. An unfiltered partner read is how one dangling
    // key took every storefront down (#1397).
    const { data: partners } = await query.graph({
      entity: "partners",
      fields: [
        "id",
        "custom_domain",
        "custom_domain_verified",
        "storefront_domain",
      ],
      filters: { id: input.partner_id },
    })

    const partner = ((partners ?? []) as any[])[0]
    if (!partner) return houseLink()

    return (
      buildQuoteBuyerUrl({
        origin: producerStorefrontUrl(partner),
        countryCode: input.destination_country_code,
        token: input.token,
      }) ?? houseLink()
    )
  } catch {
    // 🔴 The house link, not null. A partner lookup that fell over is not
    // evidence the partner has no shop, and the buyer link is the only copy of
    // the token — a reachable page on our own domain beats no email at all.
    return houseLink()
  }
}
