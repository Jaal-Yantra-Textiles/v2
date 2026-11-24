import { resolveQuoteBuyerLink } from "./quote-link"

/**
 * The buyer's brief URL: the lead partner's storefront, the destination's
 * country prefix, `/briefs/<token>`. Same origin rules as a quote link — a
 * partner brief is never sent to the house domain, where the tenant guard
 * would 404 it.
 */
export const resolveBriefBuyerLink = async (
  scope: any,
  input: { partner_id: string; destination_country_code: string; token: string }
): Promise<string | null> => {
  const quoteUrl = await resolveQuoteBuyerLink(scope, input)
  if (!quoteUrl) return null
  // buildQuoteBuyerUrl is `${origin}/${country}/quotes/${token}`; the brief
  // lives beside it.
  const suffix = `/quotes/${input.token}`
  return quoteUrl.endsWith(suffix)
    ? quoteUrl.slice(0, -suffix.length) + `/briefs/${input.token}`
    : null
}
