import { Metadata } from "next"
import { notFound } from "next/navigation"

import { retrieveQuote } from "@lib/data/quotes"
import QuoteTemplate from "@modules/quotes/templates"

type Props = {
  params: { countryCode: string; token: string }
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
  const quote = await retrieveQuote(params.token)

  // An unknown token and a revoked one are indistinguishable by design — the
  // backend 404s both so a prober learns nothing, and this preserves that.
  if (!quote) {
    notFound()
  }

  return <QuoteTemplate quote={quote} />
}
