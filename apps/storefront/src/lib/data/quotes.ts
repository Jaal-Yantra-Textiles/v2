"use server"

import { sdk } from "@lib/config"
import { setCartId } from "@lib/data/cookies"

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
  /** Goods + freight. NOT a customs-landed cost — see `QuoteTax`. */
  landed_total: number
  /** #1439 S8. Null means unknown, never zero. */
  tax_total: number | null
  /**
   * The DDP undertaking, split (#1447). Null = not a DDP quote or no figure;
   * `0` = the charge applies to this lane and is nil (AI-ECTA into AU).
   * None of them is inside `landed_total`.
   *
   * 🔴 `import_tax_total` is usually the LARGEST: 21% of goods + freight + duty
   * against an 8% duty. `ddp_fee_total` is the carrier's charge for advancing
   * the money.
   */
  duty_total: number | null
  import_tax_total: number | null
  ddp_fee_total: number | null
  /**
   * `landed_total`, plus tax when the prices are tax-exclusive (when inclusive
   * the tax is already inside it), plus any prepaid duty.
   * Null whenever `tax_total` is.
   */
  gross_total: number | null
}

/**
 * How tax was resolved for this quote (#1439 S8).
 *
 * 🔴 `reason` is rendered verbatim whenever `status` is not `calculated`. A tax
 * block that silently disappears reads as "no tax due", which is a claim; on a
 * `zero_rated_export` the zero is real but duty and import VAT still fall on the
 * buyer at their border, and that sentence is the only place they are told.
 */
export type QuoteTax = {
  status: "calculated" | "zero_rated_export" | "not_applicable" | "unknown"
  total: number | null
  inclusive: boolean
  rates: Array<{
    code: string | null
    name: string
    rate: number
    on: "goods" | "freight"
  }>
  reason: string | null
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
  /**
   * The maker's own words (#1428). ⚠️ Sourced from the PRODUCT's artisan
   * detail — neither the partner model nor `partner_onboarding_profile` carries
   * prose, so a maker with no artisan detail has no story and this is null.
   */
  story: string | null
  /** Scannable facts and the catalogue's own words. Facts only, never adjectives. */
  tags: string[]
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
  /**
   * Every image on this variant, merchandiser-ordered (#1439 S14). Empty when
   * the variant has none of its own — `thumbnail` may then be the PRODUCT's,
   * which is a weaker claim and is labelled one via `image_source`.
   */
  images?: string[]
  /**
   * The product's other colourways/sizes (#1439 S14).
   *
   * 🔴 Information, never a picker. The quote is frozen against THIS variant at
   * THIS price; the only thing a buyer can do with a different one is ask for a
   * new quote, and any UI implying otherwise describes an agreement that does
   * not exist. Render it as a statement of what the maker also weaves.
   */
  other_variants?: Array<{ id: string; title: string | null }>
  /** The EFFECTIVE quantity — the buyer's dial position, or the quoted one. */
  quantity: number
  /**
   * What the partner actually quoted this line at (#1439 S13). Null on a line
   * with no frozen row behind it.
   *
   * 🔑 The page needs BOTH numbers the moment the buyer can move quantities:
   * a dialled document that says nothing about the dial is indistinguishable
   * from the one the partner sent, and the header still calls it "your quote".
   */
  quoted_quantity?: number | null
  position: number
  note: string | null
  live_unit_amount: number | null
  live_subtotal: number | null
  quoted_unit_amount: number | null
  quoted_subtotal: number | null
  unit_weight_grams: number | null
  weight_source: "variant" | "product" | null
  /** The catalogue's own merchandising words. Empty, never null. */
  product_tags?: string[]
  product_type?: string | null
  product_collection?: string | null
}

export type QuoteFreightOption = {
  name?: string
  courier_name?: string | null
  amount: number
  currency_code: string
  estimated_days?: number | null
  source: "manual" | "calculated"
}

/** Who is selling and who is buying, for the document header (#1486). */
export type QuoteParties = {
  seller: {
    legal_name: string | null
    tax_id: string | null
    tax_id_type: string | null
    source: "partner" | "platform" | null
    origin_country_code: string | null
  }
  buyer: {
    company: string | null
    contact_name: string | null
    tax_id: string | null
    tax_id_type: string | null
    /**
     * 🔴 Always false. Nothing checks the buyer's number against VIES or the
     * GST portal, and no label on this page may imply otherwise.
     */
    tax_id_verified: boolean
  }
}

/** What pressing Accept would do, and whether it can (#1439 S11). */
export type QuoteAcceptance = {
  accepted: boolean
  accepted_cart_id: string | null
  /** False ⇒ render `blocked_reason`, never a button that will fail. */
  can_accept: boolean
  blocked_reason: string | null
  currency_code: string
  /** What the cart will charge in total, tax included. */
  total_due: number | null
  deposit_pct: number
  deposit_amount: number | null
  balance_amount: number | null
}

/** One line of the reseller block (#1428 follow-up). */
export type QuoteRetailLine = {
  variant_id: string
  product_title: string | null
  quantity: number
  /** What this buyer pays per unit. */
  unit_amount: number
  /** What the shop sells one at. Null when it could not be priced. */
  list_unit_amount: number | null
  /** Null unless there is a POSITIVE spread — never a zero presented as a fact. */
  unit_margin: number | null
  margin_pct: number | null
}

export type QuoteRetail = {
  currency_code: string
  lines: QuoteRetailLine[]
  total_at_list: number | null
  total_at_your_price: number
  total_margin: number | null
  margin_pct: number | null
  tags: string[]
}
/** One gated reason to buy here (#1428 follow-up). Facts only. */
export type QuoteAssurancePoint = {
  key: "artisanal" | "verified" | "direct" | "held"
  title: string
  body: string
}

export type QuoteAssuranceCharge = {
  key: string
  label: string
  /** Null when there is no amount to state — the note carries the fact. */
  amount: number | null
  note: string
  /** False ⇒ the buyer pays this SEPARATELY. Render it so it cannot be missed. */
  included: boolean
}

export type QuoteAssurance = {
  maker_name: string | null
  verified: boolean
  points: QuoteAssurancePoint[]
  charges: QuoteAssuranceCharge[]
  currency_code: string
  /** True ONLY when nothing beyond the shown total is payable. */
  no_further_charges: boolean
}

export type QuoteView = {
  assurance?: QuoteAssurance | null
  /** What the same goods list at, and the spread. Null when there is none. */
  retail?: QuoteRetail | null
  parties?: QuoteParties | null
  acceptance?: QuoteAcceptance | null
  lines: QuoteViewLine[]
  currency_code: string
  destination_country_code: string
  destination_postal_code: string | null
  live: QuoteMoney | null
  quoted: QuoteMoney | null
  tax: QuoteTax
  /**
   * The DDP undertaking and the duty figure behind it (#1447). `prepaid` with a
   * null `total` is a legacy row: the promise was made before anything computed
   * the amount, so the page must not print a confident "nothing further to pay".
   */
  duty: {
    prepaid: boolean
    /** Customs duty. */
    total: number | null
    /** Destination VAT/GST we also pay. */
    import_tax: number | null
    /** The carrier's fee for advancing duty and tax. */
    carrier_fee: number | null
    /** The three summed — what the undertaking adds to the buyer's total. */
    combined_total: number | null
    duty_rate_percent: number | null
    import_tax_rate_percent: number | null
    basis: string | null
  }
  total_weight_grams: number | null
  freight: {
    chosen: QuoteFreightOption | null
    options: QuoteFreightOption[]
    error: string | null
    /**
     * A person named this freight rather than a carrier rating it.
     *
     * 🔴 Load-bearing for what the buyer is TOLD. `error` alone used to decide
     * the wording, so a hand-typed DHL tariff on a lane no carrier will rate
     * still read "could not be quoted live … indicative rate" — undercutting a
     * real, looked-up number as guesswork. The two facts are independent: the
     * carrier can fail AND a human can have supplied the true figure.
     */
    overridden?: boolean
    /** The carrier that produced the rate, when one did. */
    rated_by?: string | null
  }
  /**
   * What the buyer settles at their OWN border (#1447 tail). Null on a domestic
   * supply, on a DDP quote (we are paying it, and it is already a line), and
   * wherever no destination rate is configured.
   *
   * 🔴 Deliberately outside every total. It is not ours to charge and not ours
   * to collect — folding it in would restate the exact error just removed from
   * the cart, where an Indian export was being charged 19% German VAT.
   */
  import_estimate: {
    import_tax: number
    rate_percent: number
    /** Goods + freight — the value the destination assesses. */
    basis: number
    /** Duty is additionally payable and is NOT estimated. Never guessed. */
    duty_unknown: boolean
  } | null
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
 * Returns null on ANY failure rather than throwing, and the page turns that
 * into a not-found. Letting the error bubble would render a stack-shaped 500
 * that says more than a 404 does.
 *
 * ⚠️ Only an UNKNOWN token 404s. A REVOKED one answers 200 with a `dead_link`
 * document — withdrawn headline, no price columns, acceptance refused — so it
 * never reaches this fallback. Comments elsewhere in this feature claim the two
 * are indistinguishable; they are not. Checked against a real revoked quote.
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

/**
 * Accept the quote and take the buyer to checkout (#1439 S11).
 *
 * ## The conventional route, deliberately
 *
 * The backend builds a real Medusa cart — the buyer's own customer, their
 * price list, a freight option minted in the lane the quote was rated in. This
 * action does nothing clever with it: it writes the standard `_medusa_cart_id`
 * cookie and hands the buyer to the normal checkout. Every payment provider,
 * every totals rule and every completion path is then the one the storefront
 * already uses.
 *
 * 🔴 The cookie is what makes the cart REAL to the browser. A 201 from the
 * accept route is not a cart the storefront can see — the same trap as
 * add-to-cart, where the cookie is set inside the server action's response and
 * a caller that navigates before it lands finds an empty cart.
 *
 * Idempotent by construction: `accepted_cart_id` is the quote's own key, so a
 * buyer who presses twice, or returns to the link a day later, lands on the
 * same cart rather than a second one priced against a superseded list.
 */
export const acceptQuote = async (
  token: string,
  lines?: Array<{ variant_id: string; quantity: number }>
): Promise<{ cart_id: string | null; error: string | null }> => {
  try {
    const { acceptance } = await sdk.client.fetch<{
      acceptance: { cart_id: string; already_accepted?: boolean }
    }>(`/store/b2b/quotes/${encodeURIComponent(token)}/accept`, {
      method: "POST",
      /**
       * 🔴 The basket AS RENDERED, or the cart quietly reverts to the quoted
       * quantities (#1439 S13). The page has always let a buyer move
       * quantities and re-priced the whole document through them — but
       * acceptance ignored the dial entirely, so someone who moved 29 up to 40,
       * read the new total and pressed Accept got a cart for 29. Nothing said
       * so, on the page or at checkout.
       *
       * Sent from the lines the SERVER priced rather than from the URL: the
       * rendered document is what the buyer agreed to, and the backend refuses
       * any variant not already on the quote — so a stale query string must
       * never be the thing that reaches the cart.
       */
      body: lines?.length ? { lines } : {},
      cache: "no-store",
    })

    const cartId = acceptance?.cart_id ?? null
    if (!cartId) {
      return { cart_id: null, error: "The order could not be started. Please reply to this quote." }
    }

    await setCartId(cartId)
    return { cart_id: cartId, error: null }
  } catch (e: any) {
    // Same rule as the read: log the LENGTH, never the token.
    console.error(
      `[quotes] acceptQuote failed: token_len=${token?.length ?? 0} ` +
        `status=${e?.status ?? "n/a"} message=${e?.message ?? String(e)}`
    )
    return {
      cart_id: null,
      error:
        "The order could not be started just now. Please try again, or reply to this quote.",
    }
  }
}
