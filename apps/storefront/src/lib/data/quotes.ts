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

/** One labelled fact about how the piece is made. #1428 */
export type QuoteSpecRow = {
  key: string
  label: string
  value: string
  unit: string | null
  /** A glyph NAME from the backend's weaving-technique registry, not an asset. */
  icon: string
}

/**
 * What the piece is made to.
 *
 * 🔑 FACTS only. The made-to-order choices — the palette, the option groups —
 * are deliberately absent from this payload: a quote is frozen against
 * specific variants at specific prices, and a configurator the buyer cannot
 * act on is worse than no configurator.
 */
export type QuoteLineSpec = {
  weave_label: string | null
  rows: QuoteSpecRow[]
  finishes: string[]
}

/** The producing partner, when the buyer is NOT on that partner's own shop. */
export type QuoteProducer = {
  id: string
  name: string | null
  handle: string | null
  logo: string | null
  country_code: string | null
  is_verified: boolean
  /** The partner's own shop. Null when they have no verified/provisioned host. */
  url: string | null
}

/** One labelled, public-safe fact about the maker. #1439 S9 */
export type ProvenanceRow = {
  /** Stable machine key, so a renderer can style or reorder without parsing labels. */
  key: string
  label: string
  value: string
  /** Which record the fact came from — an unattributed fact is a claim. */
  source: "partner" | "partner-onboarding-profile" | "artisan-product-detail"
}

/**
 * Who made this, and how.
 *
 * 🔑 The backend OMITS a row whose fact is absent rather than em-dashing it, and
 * excludes every commercial term. Render `rows` as given — never add a
 * placeholder value, and never widen this shape client-side.
 */
export type Provenance = {
  maker_name: string | null
  /** Free prose, rendered as a paragraph rather than a row. */
  maker_story: string | null
  rows: ProvenanceRow[]
}

export type QuoteViewLine = {
  variant_id: string
  variant_title: string | null
  product_id: string | null
  product_title: string | null
  product_handle: string | null
  /**
   * The variant's own image, else the product thumbnail, else nothing.
   * 🔴 Never substitute a placeholder photo: the buyer is agreeing to *that*
   * item, and a plausible wrong picture is worse than an empty cell.
   */
  thumbnail: string | null
  image_source: "variant" | "product" | null
  spec: QuoteLineSpec | null
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
  /**
   * Null means "say nothing", never "unknown producer". The backend decides;
   * on the partner's own storefront the partner IS the seller and naming them
   * again is noise.
   */
  producer: QuoteProducer | null
  /**
   * The maker section. Null means "say nothing" — a partner with a thin profile
   * degrades to fewer rows, and one we know nothing about to no section at all.
   */
  provenance: Provenance | null
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
  } catch (e: any) {
    /**
     * The buyer-facing behaviour is unchanged: null becomes a 404, and an
     * unknown token stays indistinguishable from a revoked one.
     *
     * 🔑 But the OPERATOR needs the cause. Every failure here — a bad token, an
     * unreachable backend, a missing publishable key, a 500 in the view builder
     * — used to collapse into the same silent 404, which made a Next 16 params
     * regression (#1427: the token arrived as the literal string `undefined`)
     * indistinguishable from a revoked link. Log the token LENGTH, never the
     * token: it is the credential.
     */
    console.error(
      `[quotes] retrieveQuote failed: token_len=${token?.length ?? 0} ` +
        `status=${e?.status ?? "n/a"} message=${e?.message ?? String(e)}`
    )
    return null
  }
}
