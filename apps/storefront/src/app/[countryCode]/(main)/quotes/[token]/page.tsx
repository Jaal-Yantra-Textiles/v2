import { Metadata } from "next"
import { notFound } from "next/navigation"

import { retrieveQuote } from "@lib/data/quotes"
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

export default async function QuotePage({ params }: Props) {
  const { token } = await params
  const quote = await retrieveQuote(token)

  // An unknown token and a revoked one are indistinguishable by design — the
  // backend 404s both so a prober learns nothing, and this preserves that.
  if (!quote) {
    notFound()
  }

  return <QuoteTemplate quote={quote} />
}
