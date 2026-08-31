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
 * ## The house fallback is ONLY for a house quote
 *
 * A quote with no partner falls back to the platform storefront, from
 * `ROOT_DOMAIN` (cicilabel.com) with `FRONTEND_URL` as the second choice.
 *
 * 🔴 A PARTNER's quote never does, and the reason is not preference — it is
 * that the link would not work. `assertQuoteVisibleToCaller` refuses any read
 * whose calling publishable key resolves to a store other than the quote's
 * own, and that guard exists because three stores' keys once all returned 200
 * for the same token (#1439 S15). Verified live on 2026-08-31 against quote
 * `01M1BPV6TM…`: `GET /store/b2b/quotes/<token>` answered **404** under the
 * house key and **200** under the owning partner store's. So a house link for
 * a partner quote is a 404 dressed as a link, and the buyer link is the only
 * copy of the token.
 *
 * Null instead. `deliverQuoteEmail` already treats a missing link as a refusal
 * to send — "an email without the link is worse than no email" — and records
 * it on the quote's timeline for a human to act on. A quote nobody can open is
 * a fact worth surfacing at the mint, not one to paper over with a URL that
 * resolves to a not-found page.
 *
 * 🔑 A partner's buyer must land on the partner's own shop for a second reason
 * too: the page names the producer, prices against their catalogue and, once
 * accepted, builds a cart in their sales channel.
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

    // 🔴 NOT the house link. This quote belongs to the partner's store, and the
    // tenant guard refuses it to every other store's key — a house URL here
    // would 404 for the buyer.
    if (!partner) return null

    return buildQuoteBuyerUrl({
      origin: producerStorefrontUrl(partner),
      countryCode: input.destination_country_code,
      token: input.token,
    })
  } catch {
    // Null, for the same reason. A failed lookup is not evidence the partner
    // has no shop — but nor does it make a house link work, and "here is your
    // quote" pointing at a not-found page is worse for the buyer than the mint
    // telling a human the link could not be built.
    return null
  }
}
