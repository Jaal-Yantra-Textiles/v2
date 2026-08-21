"use server"

import { sdk } from "@lib/config"

/**
 * The buyer's quote (#1389 S4).
 *
 * The token in the URL is the only credential — there is no login, because
 * asking a procurement contact to create an account before they can see a price
 * is the wall this whole feature exists to remove. The link is deliberately
 * multi-view: forwarding it to procurement is the use case, not an abuse of it.
 *
 * 🔴 Deliberately NOT cached. Every other fetcher here uses `force-cache` with
 * a tag, but a quote is a per-token document whose backend records `viewed_at` /
 * `view_count` on read — caching it would both leak one buyer's quote to another
 * token's cache entry if the key were ever wrong, and silently stop the view
 * tracking the partner relies on to know the buyer looked.
 */

export type QuoteMoney = {
  unit_amount: number
  subtotal: number
  freight: number
  landed_total: number
}

export type QuoteViewLine = {
  variant_id: string
  variant_title: string | null
  product_id: string | null
  product_title: string | null
  product_handle: string | null
  quantity: number
  position: number
  note: string | null
  live_unit_amount: number | null
  live_subtotal: number | null
  quoted_unit_amount: number | null
  quoted_subtotal: number | null
  unit_weight_grams: number | null
  weight_source: "variant" | "product" | null
}

export type QuoteFreightOption = {
  name?: string
  courier_name?: string | null
  amount: number
  currency_code: string
  estimated_days?: number | null
  source: "manual" | "calculated"
}

export type QuoteView = {
  lines: QuoteViewLine[]
  currency_code: string
  destination_country_code: string
  destination_postal_code: string | null
  live: QuoteMoney | null
  quoted: QuoteMoney | null
  total_weight_grams: number | null
  freight: {
    chosen: QuoteFreightOption | null
    options: QuoteFreightOption[]
    error: string | null
  }
  compare: {
    state: string
    show_quoted: boolean
    show_live: boolean
    landed_delta: number | null
    headline: string
    explanation: string
    disclaimer: string | null
    expiry_notice: string | null
  }
  recipient: {
    name: string | null
    company: string | null
    partner_note: string | null
  }
  expires_in_days: number | null
  live_error: string | null
}

/**
 * Fetch a quote by token.
 *
 * Returns null on ANY failure rather than throwing. An unknown token and a
 * revoked one are both 404 by design — a prober must not be able to tell them
 * apart — and the page turns either into the same not-found. Letting the error
 * bubble would render a stack-shaped 500 that says more than the 404 does.
 */
export const retrieveQuote = async (
  token: string,
  lines?: Array<{ variant_id: string; quantity: number }>
): Promise<QuoteView | null> => {
  try {
    const { quote } = await sdk.client.fetch<{ quote: QuoteView }>(
      `/store/b2b/quotes/${encodeURIComponent(token)}`,
      {
        method: "GET",
        // The buyer may move their quantities; absent that, the quoted basket
        // stands. Serialised because the backend parses it as JSON.
        query: lines?.length ? { lines: JSON.stringify(lines) } : undefined,
        cache: "no-store",
      }
    )
    return quote ?? null
  } catch {
    return null
  }
}
