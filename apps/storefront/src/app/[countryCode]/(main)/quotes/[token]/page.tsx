import { Metadata } from "next"
import { notFound, redirect } from "next/navigation"

import { retrieveQuote } from "@lib/data/quotes"
import { getRegion } from "@lib/data/regions"
import { parseDialledLines } from "@lib/util/quote-lines"
import QuoteTemplate from "@modules/quotes/templates"

/**
 * 🔴 `params` is a PROMISE. Next 15 still allowed synchronous access with a
 * deprecation warning; Next 16 removed that fallback, so reading `.token` off
 * the unawaited promise yields `undefined` — and this app is on Next 16 while
 * `apps/storefront-starter` is on Next 15. This file was ported verbatim
 * between the two (#1427), which is exactly how the shape regressed: the
 * fetch went out as `/store/b2b/quotes/undefined`, the backend correctly 404'd
 * an unknown token, and `retrieveQuote`'s catch-all turned it into a
 * not-found page. Identical files across two majors is the bug, not the fix.
 */
type Props = {
  params: Promise<{ countryCode: string; token: string }>
  /**
   * The buyer's dialled basket (#1439 S13), as `?lines=variant_x:40,variant_y:12`.
   *
   * 🔴 A promise too, for the same reason `params` is — and the same trap. See
   * the note above: this app is on Next 16, `apps/storefront-starter` is on
   * Next 15, and reading a field off the unawaited promise is `undefined` on
   * one and a deprecation warning on the other. Here the failure would be
   * quieter than #1427 was: an un-awaited `searchParams` yields no dial, the
   * quoted basket renders perfectly, and the buyer's +/− simply stops working
   * with nothing in any log to say why.
   */
  searchParams: Promise<{ lines?: string | string[] }>
}

/**
 * 🔴 A quote link must never be indexed or crawled: the token IS the credential.
 * `noindex, nofollow` is the minimum. The link is otherwise deliberately
 * multi-view, because forwarding it to procurement is the use case, not an
 * abuse of it.
 */
export const metadata: Metadata = {
  title: "Your quote",
  description: "Your quoted prices and landed cost.",
  robots: { index: false, follow: false },
}

/**
 * Rendered per request, never cached or statically generated: the backend
 * records `viewed_at` / `view_count` on read, so a cached page would silently
 * stop the view tracking the partner relies on — and would risk serving one
 * token's document under another's key.
 */
export const dynamic = "force-dynamic"

export default async function QuotePage({ params, searchParams }: Props) {
  const [{ token, countryCode }, { lines }] = await Promise.all([
    params,
    searchParams,
  ])

  /**
   * The quantities the buyer has dialled, if any (#1439 S13).
   *
   * 🔑 Handed to the backend, which re-prices the ENTIRE document through them
   * — line subtotals, the freight the carrier rates for the new weight, the tax
   * band the new goods value falls in, the deposit. Nothing on this page does
   * price arithmetic in the browser, because a quantity crossing a price-list
   * tier, a carrier weight slab or a tax threshold would make it quietly wrong.
   *
   * An unparseable dial is dropped rather than 404'd: the quoted basket is
   * always a correct answer, and a link mangled in an email client should not
   * cost the buyer their price.
   */
  const dialledLines = parseDialledLines(lines)
  const quote = await retrieveQuote(token, dialledLines)

  /**
   * ⚠️ An UNKNOWN token 404s. A REVOKED one does not — verified against a real
   * revoked quote, which returns 200 with a `dead_link` document: the headline
   * says the partner withdrew it, `show_quoted` and `show_live` are both false
   * so no price is rendered, and acceptance is refused. That is deliberate and
   * kinder than a 404, but the two are therefore NOT indistinguishable to a
   * prober, which several comments in this feature still claim. Nothing
   * actionable leaks either way; the tokens are high-entropy, so the
   * distinguishability is a curiosity rather than a hole.
   *
   * This branch is only ever the unknown-token case.
   */
  if (!quote) {
    notFound()
  }

  /**
   * 🔴 The quote decides the prefix, not the URL (#1787).
   *
   * This used to read: *"a checkout link built from the quote's DESTINATION
   * would leave the locale the buyer is actually browsing"* — treating the
   * route segment as authoritative. It is not, and a live buyer could not pay
   * because of it. `buildQuoteBuyerUrl` mints the link under the quote's own
   * country, but the middleware falls back to `NEXT_PUBLIC_DEFAULT_REGION` for
   * any path whose first segment is not a known country, so a single
   * un-prefixed internal link (the abandoned-cart recovery mail sends one) is
   * enough to put an AU buyer on `/in`. From there the accept pushes to
   * `/in/checkout`, the cart resolves payment providers from India — PayU, never
   * Stripe — and the address form's region-scoped country select offers only
   * `in` against her `au` address, silently refusing to submit.
   *
   * A quote is a document about one destination. There is no locale to preserve.
   *
   * ⚠️ Only redirect where the destination actually HAS a region: a prefix with
   * no region would be rewritten by the middleware to the default one, which is
   * the very state this is here to prevent.
   */
  const destination = quote.destination_country_code?.toLowerCase() || null
  const destinationRegion = destination ? await getRegion(destination) : null

  if (destinationRegion && destination && destination !== countryCode) {
    // The dialled basket is part of what the buyer is looking at — dropping it
    // on the redirect would reset their quantities to the quoted ones without
    // saying so.
    const dial = Array.isArray(lines) ? lines[0] : lines
    const query = dial ? `?lines=${encodeURIComponent(dial)}` : ""
    redirect(`/${destination}/quotes/${token}${query}`)
  }

  return (
    <QuoteTemplate
      quote={quote}
      token={token}
      countryCode={countryCode}
      // Normally identical to `countryCode` — the redirect above has already
      // agreed them. It differs only in the un-redirectable case: a destination
      // this storefront has no region for.
      checkoutCountryCode={destinationRegion && destination ? destination : countryCode}
    />
  )
}
