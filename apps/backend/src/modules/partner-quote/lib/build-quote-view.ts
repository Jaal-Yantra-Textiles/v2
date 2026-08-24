import { ContainerRegistrationKeys, MedusaError, QueryContext } from "@medusajs/framework/utils"

import {
  resolveQuoteProvenance,
} from "../../../lib/provenance/resolve-provenance"
import type { Provenance } from "../../../lib/provenance/build-provenance"
import {
  buildShippingEstimate,
  type ShippingEstimate,
  type ShippingEstimateOption,
} from "../../../lib/shipping-estimate"
import {
  compareQuote,
  type QuoteCompareResult,
  type QuoteMoney,
} from "./compare"
import { resolveQuoteProducer, type QuoteProducer } from "./quote-producer"
import { composeQuoteAssurance, type QuoteAssurance } from "./quote-assurance"
import { composeQuoteRetail, type QuoteRetail } from "./quote-retail"
import {
  resolveBuyerImportEstimate,
  resolveQuoteTax,
  type QuoteImportEstimate,
  type QuoteTax,
} from "./quote-tax"
import { computeDdpCharges, describeDdpBasis } from "./ddp-charges"
import {
  pickRatingCarrier,
  readEnabledCarrierIds,
} from "../../shipping-providers/rating-carrier"
import { classifyQuoteJurisdiction } from "./quote-tax"
import { resolveQuoteSpecs, type QuoteLineSpec } from "./quote-spec"
import { resolveLineSize, type QuoteLineSize } from "./quote-size"
import { daysUntilExpiry, quoteUnusableReason } from "./token"
/**
 * Imported, never restated. `customer.groups.id` vs `customer_group_id` is the
 * exact pair that made the first minted quote price nothing at all (#1389), and
 * a second copy of the string is how that comes back.
 *
 * `plan-quote-prices` imports nothing, so this cannot cycle.
 */
import { QUOTE_GROUP_RULE_ATTRIBUTE } from "../../../workflows/partner-quote/lib/plan-quote-prices"

/**
 * The one builder, so the page and the email cannot drift (#1389 S2).
 *
 * ## Three callers, one implementation
 *
 * 1. the public `/store/b2b/quotes/:token` route — what the buyer sees,
 *    recomputed live as they move the quantity dial;
 * 2. the email retrieval step — what the buyer receives;
 * 3. **mint**, where this same output is frozen into the row's `quoted_*`
 *    columns.
 *
 * Because (3) freezes (1)'s output, the quoted numbers are literally the live
 * builder's answer at mint time. There is no second pricing path that could
 * disagree with the page — which is the whole reason this file exists rather
 * than each caller assembling its own view.
 *
 * ## The trap this file is built around
 *
 * 🔴 `variant.calculated_price` is the QUANTITY-1 price on every `/store/*`
 * route, because only the cart sets `context.quantity`. Rendering "price at
 * 500" from an ordinary product payload is silently the price at 1, and on a
 * tiered product that is a materially wrong number shown to a buyer.
 *
 * So the price here is fetched with an explicit
 * `QueryContext({ region_id, currency_code, quantity })`. That is not a detail
 * to preserve on refactor — it is the feature.
 *
 * ## A basket, not a line
 *
 * A quote holds many lines. Each line is priced at ITS OWN quantity, because
 * the tier a buyer lands on is per product — 500 of one and 20 of another are
 * two different tiers, not one blended rate. Freight is quoted ONCE for the
 * whole consignment, on the summed weight, and lives on the quote rather than
 * on any line.
 *
 * ## What is never done here
 *
 * Nothing this builder returns prices a cart. `quoted_*` is evidence; the cart
 * prices itself. And a dead link is never re-priced: a revoked or expired quote
 * returns `live: null` and shows the buyer what they were told, not a fresh
 * number they cannot act on.
 */

export type QuoteViewLineRow = {
  variant_id: string
  /** The design this line was picked as (#1486). Provenance, never pricing. */
  design_id?: string | null
  quantity?: number
  position?: number
  note?: string | null
  quoted_unit_amount?: number | null
  quoted_subtotal?: number | null
  quoted_unit_weight_grams?: number | null
  quoted_weight_source?: "variant" | "product" | null
}

export type QuoteViewQuote = {
  id?: string
  status?: string
  expires_at?: Date | string | null
  destination_country_code?: string | null
  destination_postal_code?: string | null
  quoted_subtotal?: number | null
  quoted_freight?: number | null
  quoted_landed_total?: number | null
  quoted_weight_grams?: number | null
  /** #1439 S8. Null on every quote minted before tax existed. */
  quoted_tax_total?: number | null
  quoted_tax_inclusive?: boolean | null
  /** #1439 S8 tail. Frozen so a dead link can still say WHY the tax is what it is. */
  quoted_tax_status?: string | null
  quoted_tax_reason?: string | null
  duties_prepaid?: boolean | null
  /** #1447. The DDP charges we committed to, and how they were arrived at. */
  quoted_duty_total?: number | null
  quoted_import_tax_total?: number | null
  quoted_ddp_fee_total?: number | null
  quoted_duty_rate?: number | null
  quoted_import_tax_rate?: number | null
  quoted_duty_basis?: string | null
  quoted_at?: Date | string | null
  recipient_name?: string | null
  recipient_company?: string | null
  partner_note?: string | null
  lines?: QuoteViewLineRow[] | null
}

/** One line as the buyer is currently looking at it. */
export type BuildQuoteViewLine = {
  variant_id: string
  /** The design this line was picked as (#1486). Provenance, never pricing. */
  design_id?: string | null
  quantity: number
  position?: number
  note?: string | null
}

export type BuildQuoteViewInput = {
  /** The persisted row. Null at mint, when there is nothing frozen yet. */
  quote?: QuoteViewQuote | null
  /**
   * The buyer's customer group, so the LIVE re-price sees the price list that
   * was minted for them (#1389 S3).
   *
   * 🔴 Set on a READ, never at mint. At mint there is no list yet, and the
   * buyer's group may still carry the PREVIOUS quote's list — `supersede` runs
   * after the freeze. Passing it there would price a re-quote off the quote it
   * is replacing, and two active lists on one group tie-break CHEAPEST (#1435).
   */
  customer_group_id?: string | null
  /** Effective basket — the buyer's dial positions, or the quoted ones. */
  lines: BuildQuoteViewLine[]
  destination_country_code: string
  destination_postal_code?: string | null
  currency_code: string
  region_id?: string | null
  /** The partner store: origin location and pricing scope. */
  store: { id?: string; default_location_id?: string | null }
  /** The producing partner. Only needed to render the credit — never priced. */
  partner_id?: string | null
  /**
   * The sales channels of the storefront SERVING this page, from its
   * publishable key. Decides whether naming the producer is a selling point or
   * noise — see `quote-producer.ts`. Absent ⇒ say nothing.
   */
  viewer_sales_channel_ids?: string[] | null
  carrier?: string
  /**
   * Quote as DDP — we pay destination duty and import tax. Supplied by the mint
   * (the row does not exist yet); afterwards it is read off the frozen quote.
   */
  duties_prepaid?: boolean
  /**
   * The duty we are undertaking to pay, in the quote currency, and the note
   * saying how the partner got there (#1447). Supplied by the mint; afterwards
   * both are read off the frozen row so a re-read cannot invent a new figure.
   *
   * Only meaningful with `duties_prepaid` — the API refuses one without the
   * other, so a DDP promise always carries a number.
   */
  duty_total?: number | null
  duty_basis?: string | null
  /**
   * The rate form (#1447), and the preferred one. The wizard collects the two
   * percentages and the AMOUNTS ARE COMPUTED HERE, against the quote's own
   * subtotal and freight — the wizard cannot know those before the mint prices
   * the basket, so a client-computed amount would be an estimate frozen as a
   * commitment.
   *
   * Duty is assessed on goods + freight; import tax on goods + freight + duty.
   * The cascade is the part people get wrong by hand, always in the direction
   * that under-funds the promise.
   */
  duty_rate_percent?: number | null
  import_tax_rate_percent?: number | null
  /** A flat import tax, where a rate does not express the lane. */
  import_tax_total?: number | null
  /** The carrier's charge for advancing duty and tax. Always an amount. */
  ddp_fee_total?: number | null
  /**
   * Freight the partner is naming BY HAND, in the quote currency (#1439 S12).
   *
   * ## Why this exists
   *
   * 🔴 The stored international option is a **flat amount at any weight** — 35
   * EUR whether the consignment is 5.5 kg or 22 kg — and the obvious fix is
   * closed: the estimator deliberately skips every rule-bound price row, which
   * is the #1430 fix that stopped a rule-gated `0 INR` shipping bulk orders
   * free. Meanwhile the live cross-border leg answers `No serviceable couriers
   * available for given weight`, so a real rate is not available either.
   *
   * Until the carriers answer, the honest number is the one the partner has in
   * front of them from a forwarder. Naming it beats quoting a flat tier that is
   * wrong in the direction nobody complains about.
   *
   * ## What it does
   *
   * It REPLACES the picked option's amount and nothing else. The consignment
   * weight, the option list and the lane are still computed, because they are
   * what makes the number checkable — and tax, duty and the landed total are
   * all derived from this freight exactly as they would be from a rated one.
   *
   * 🔑 In the QUOTE currency, unlike an S7 line override which is in the
   * partner store's currency. Deliberate: a line override is compared against a
   * catalogue price that has a currency of its own, whereas freight sits beside
   * `duty_total`, `import_tax_total` and `ddp_fee_total` in both the wizard and
   * this type — all of which are quote-currency amounts. One rule for the
   * numbers that appear together.
   */
  freight_override_amount?: number | null
  /**
   * Who quoted that number and on what basis — "DHL rate card 12 Aug, 22 kg to
   * DE", "Blue Dart forwarder quote".
   *
   * Evidence, not decoration, and the same argument as `duty_basis`: this is
   * the only record of why we committed to a freight figure, and the person who
   * later pays the forwarder's invoice is not the person who typed it.
   */
  freight_basis?: string | null
  /** Passed in so the whole view is deterministic under test. */
  now: Date
}

export type QuoteViewLine = {
  variant_id: string
  /** The design this line was picked as (#1486). Provenance, never pricing. */
  design_id?: string | null
  /** The catalogue's own merchandising words. Empty, never null. */
  product_tags: string[]
  product_type: string | null
  /** The type's ID, carried for TAX RULES — never for display (#1447 tail). */
  product_type_id: string | null
  product_collection: string | null
  variant_title: string | null
  product_id: string | null
  product_title: string | null
  product_handle: string | null
  /**
   * The variant's own image where it has one, else the product thumbnail.
   * 🔑 Null rather than a stand-in: a WRONG image on a quote is worse than no
   * image, because the buyer is agreeing to *that* item.
   */
  thumbnail: string | null
  /** Which level the image came from, so a caller can caption it honestly. */
  image_source: "variant" | "product" | null
  /**
   * What the piece is made to — FACTS only, never the made-to-order choices.
   * Null when the product has no spec, which is the normal state.
   */
  spec: QuoteLineSpec | null
  /** The finished piece's size, and which source stated it. Null when nobody did. */
  size: QuoteLineSize | null
  /**
   * Every image on this variant, merchandiser-ordered (#1439 S14). Empty when
   * the variant has none of its own — `thumbnail` may still be the product's.
   */
  images: string[]
  /**
   * The product's other variants, for information only (#1439 S14).
   *
   * 🔴 Not a picker. The quote is frozen against THIS variant at THIS price;
   * the only thing a buyer can do with a different one is ask for a new quote,
   * and any UI implying otherwise is lying about what has been agreed.
   */
  other_variants: Array<{ id: string; title: string | null }>
  /** The EFFECTIVE quantity — the buyer's dial position, or the quoted one. */
  quantity: number
  /**
   * What the partner actually quoted this line at (#1439 S13).
   *
   * Carried so a page that lets the buyer move quantities can say which number
   * is theirs and which is the partner's. Without it a dialled document is
   * indistinguishable from the one that was sent, while the header still calls
   * it "your quote" — the buyer's own edit reads as the supplier's offer.
   *
   * Null only on a line with no frozen row behind it.
   */
  quoted_quantity: number | null
  position: number
  note: string | null
  /** Recomputed now, at THIS line's quantity. Null when the live half failed. */
  live_unit_amount: number | null
  live_subtotal: number | null
  /** Frozen at mint for this line. */
  quoted_unit_amount: number | null
  quoted_subtotal: number | null
  unit_weight_grams: number | null
  /** Per line, because a basket can mix variant- and product-weighted items. */
  weight_source: "variant" | "product" | null
}

export type QuoteView = {
  lines: QuoteViewLine[]
  currency_code: string
  destination_country_code: string
  destination_postal_code: string | null
  /** Recomputed now. Null on a dead link, or when freight could not be quoted. */
  live: QuoteMoney | null
  /** Frozen at mint. Null before the first freeze. */
  quoted: QuoteMoney | null
  /** Whole-consignment weight the live freight was quoted against. */
  total_weight_grams: number | null
  /** The freight option the live total used, and everything else on the lane. */
  freight: {
    chosen: ShippingEstimateOption | null
    options: ShippingEstimateOption[]
    error: string | null
    /**
     * True when a person named the amount rather than a rate producing it
     * (#1439 S12). Distinct from `chosen.source`, which says whether the figure
     * came from a stored option or a live carrier call — a different question
     * with the same word for one of its answers.
     */
    overridden: boolean
    /**
     * Which carrier was ASKED for the live rates (#1447). Null when nobody was
     * — a manual-only lane, or a dead link. Surfaced because "a partner shipping
     * Delhivery was quoted by Shiprocket" is invisible in a number that looks
     * perfectly reasonable.
     */
    rated_by: string | null
  }
  /**
   * Tax on this quote (#1439 S8), and — when there is no number — the reason,
   * which the page RENDERS. A missing tax block reads as "no tax due", so
   * silence is not an option here the way it is for the producer band.
   */
  tax: QuoteTax
  /**
   * Whether the prices this view was built from already contain tax, as the
   * pricing module reported them. Null when nothing was priced.
   *
   * 🔑 Exposed so the mint's tax re-ask can use the SAME answer rather than
   * asking the region again — the two must never be able to disagree, which is
   * exactly the divergence that made every quote unacceptable.
   */
  prices_tax_inclusive: boolean | null
  /**
   * Indicative destination charges the BUYER settles at their own border
   * (#1447 tail). Null on a domestic supply, on a DDP quote, and wherever no
   * destination rate is configured.
   *
   * 🔴 Never part of `live` or `quoted`. It is not ours to charge and not ours
   * to collect; folding it into a total would restate the exact error we just
   * removed from the cart.
   */
  import_estimate: QuoteImportEstimate | null
  /**
   * The DDP undertaking and the number behind it (#1447).
   *
   * `prepaid` without a `total` is the state this slice exists to make
   * impossible: it is a promise that duty is covered with nothing added to the
   * price, paid out of margin by an amount nobody worked out. The API refuses
   * that combination at mint; the block is shaped so a caller can still SEE it
   * on a legacy row rather than render a confident "nothing further to pay".
   *
   * Read from the frozen quote on a dead link, exactly like `tax` — the
   * undertaking is part of what the buyer was told, and a revoked quote is the
   * record of it.
   */
  duty: {
    prepaid: boolean
    /** Customs duty. Quote currency. Null = no figure; 0 = applies and is nil. */
    total: number | null
    /** Destination VAT/GST we also pay — usually the LARGEST of the three. */
    import_tax: number | null
    /** The carrier's fee for advancing duty and tax on our behalf. */
    carrier_fee: number | null
    /** What the undertaking adds to the buyer's total: the three summed. */
    combined_total: number | null
    /** The rates applied, so the figures can be re-derived, not just believed. */
    duty_rate_percent: number | null
    import_tax_rate_percent: number | null
    /** "EU 12% ad valorem, HS 6304.92", "AI-ECTA duty-free". */
    basis: string | null
  }
  compare: QuoteCompareResult
  recipient: {
    name: string | null
    company: string | null
    partner_note: string | null
  }
  /**
   * The producing partner, when the viewer is NOT on that partner's own
   * storefront. Null means "say nothing", never "unknown producer".
   */
  producer: QuoteProducer | null
  /**
   * What the same goods sell for on the shop, and the spread (#1428).
   * Null when there is no spread to report — see `quote-retail.ts`.
   */
  retail: QuoteRetail | null
  /**
   * Why buy here, and the full composition of what the buyer pays.
   * Every point is gated on a fact; the partner's commercial terms are NOT in
   * it — see `quote-assurance.ts`.
   */
  assurance: QuoteAssurance
  /**
   * Who made this and how — the partner's public-safe credentials plus the
   * product facts the whole basket agrees on (#1439 S9). Null means "say
   * nothing": a thin partner profile degrades to silence, never to a grid of
   * blanks. Rendered by the buyer page; the shaper's exclusion list is what
   * keeps commercial terms off it.
   */
  provenance: Provenance | null
  expires_in_days: number | null
  /**
   * Where the goods dispatch from, ISO-2 upper-case (#1447). Null when it could
   * not be read — and null means UNKNOWN, never domestic: assuming would let a
   * DDP undertaking be refused on a real export.
   */
  origin_country_code: string | null
  /** Set when the live half could not be built, so callers can say why. */
  live_error: string | null
}

/**
 * PURE: the cheapest quotable option on the lane.
 *
 * Cheapest, not "recommended": a recommendation is the carrier's commercial
 * opinion, and a buyer comparing suppliers is comparing the number they would
 * actually pay. Every option is still returned, so the page can show the rest.
 *
 * ## 🔴 Why a CALCULATED winner borrows a lane from a manual one (#1498)
 *
 * A carrier rate is a courier and a price. It is not a Medusa shipping option,
 * so it carries no `shipping_option_id` — and acceptance needs one: it mints
 * the cart's flat freight option in the SAME service zone and shipping profile
 * as the option the quote was rated against, and refuses outright when the
 * quote froze none (`create-quote-freight-option-step`).
 *
 * So a quote whose freight came from a live rate could never be accepted. That
 * stayed hidden while cross-border lanes fell to the flat fallback and won on
 * the manual row; #1498 makes carrier rates win international lanes for the
 * first time, which would have turned a pricing improvement into "this quote
 * cannot be bought" — the #1497 failure again, and again discovered by the
 * buyer at the last step.
 *
 * The donor is any manual option still standing, and by this point that list is
 * already filtered to zones covering the destination, to the quote currency and
 * to non-return options. Its ZONE is all that is borrowed — never its price.
 * When there is no manual option at all the id stays null and acceptance
 * refuses with the message #1497 wrote, which is the honest answer: the store
 * genuinely has no configured lane to that country.
 */
export function pickFreightOption(
  estimate: Pick<ShippingEstimate, "manual" | "calculated">
): ShippingEstimateOption | null {
  const all = [...(estimate.calculated || []), ...(estimate.manual || [])]
    .filter((o) => Number.isFinite(Number(o?.amount)))
    .sort((a, b) => Number(a.amount) - Number(b.amount))
  const winner = all[0] ?? null
  if (!winner || winner.shipping_option_id) return winner

  const laneOption = (estimate.manual || []).find((o) => o.shipping_option_id)
  if (!laneOption) return winner
  return { ...winner, shipping_option_id: laneOption.shipping_option_id }
}

/**
 * PURE: the one image for a quoted line — variant first, product thumbnail
 * second, nothing third (#1428).
 *
 * 🔴 Never a placeholder and never "any image on the product". A buyer signing
 * off a seven-figure consignment is agreeing to *that* item, so a plausible
 * wrong picture is more damaging than an empty cell. Where the image came from
 * travels with it, the same way `weight_source` does, because a PRODUCT
 * thumbnail on a variant-specific line is a weaker claim than the variant's
 * own photo.
 */
/**
 * Every image on the quoted variant, in the merchandiser's order (#1439 S14).
 *
 * The identity query has always fetched all of them; `pickLineImage` took the
 * first and the rest were thrown away. A buyer approving 500 units of a weave
 * wants the drape and the selvedge, not one crop of it.
 *
 * 🔴 The product thumbnail is deliberately NOT appended as a fallback. It is
 * already what `thumbnail` degrades to, and mixing a product-level photo into
 * a variant's gallery would present a weaker claim as if it were one of this
 * colourway's own shots — the same reason `image_source` exists at all.
 * Returns `[]` rather than a one-item array in that case, so a caller can tell
 * "no gallery" from "a gallery of one".
 */
export function lineImages(identity: any): string[] {
  return ((identity?.images ?? []) as any[])
    .filter((i) => i?.url)
    .sort((a, b) => Number(a?.rank ?? 0) - Number(b?.rank ?? 0))
    .map((i) => String(i.url))
}

export function pickLineImage(identity: any): {
  thumbnail: string | null
  image_source: "variant" | "product" | null
} {
  const images = ((identity?.images ?? []) as any[]).filter((i) => i?.url)
  if (images.length) {
    // `rank` is the merchandiser's ordering; fall back to array order when a
    // row predates it rather than dropping to the product thumbnail.
    const first = [...images].sort(
      (a, b) => Number(a?.rank ?? 0) - Number(b?.rank ?? 0)
    )[0]
    if (first?.url) return { thumbnail: String(first.url), image_source: "variant" }
  }
  const productThumb = identity?.product?.thumbnail
  if (productThumb) return { thumbnail: String(productThumb), image_source: "product" }
  return { thumbnail: null, image_source: null }
}

/**
 * PURE: basket totals from priced lines and the one freight leg.
 *
 * `unit_amount` on a basket total is only meaningful for a single-line quote;
 * for a real basket it is the blended per-unit figure, which is why the lines
 * carry their own and this is only ever the summary row.
 */
/**
 * The country the partner store dispatches from, or null.
 *
 * Reads `stock_location.address.country_code` directly rather than going through
 * the shipping module's origin-address helper, which returns undefined unless
 * the address also has a street line and a pincode (Blue Dart validates that
 * block as a unit). A country has no such dependency, and a quote must not lose
 * its tax treatment because a warehouse is missing a postcode.
 *
 * Never throws — a null lands the quote on `status: "unknown"` WITH a reason,
 * which is the honest degradation. It must not become an assumed "domestic".
 */
export async function resolveStoreOriginCountry(
  scope: any,
  locationId?: string | null
): Promise<string | null> {
  if (!locationId) return null
  try {
    const query: any = scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: locs } = await query.graph({
      entity: "stock_location",
      fields: ["id", "address.country_code"],
      filters: { id: locationId },
    })
    const code = String((locs ?? [])[0]?.address?.country_code || "").trim()
    return /^[A-Za-z]{2}$/.test(code) ? code.toUpperCase() : null
  } catch {
    return null
  }
}

export function composeQuoteMoney(
  lineSubtotals: number[],
  totalUnits: number,
  freight: number,
  /**
   * #1439 S8. Omitted ⇒ tax is UNKNOWN, not zero: `tax_total` and
   * `gross_total` both stay null, and the caller is expected to say why.
   */
  tax?: { total: number | null; inclusive: boolean } | null,
  /**
   * #1447. The DDP undertaking, in the quote currency: customs duty, the
   * destination import tax we also pay, and the carrier's fee for advancing
   * them. Omitted ⇒ not a DDP quote, and no duty rows render. A `0` is a
   * different statement: the charge applies to this lane and it is nil.
   */
  ddp?: { duty?: number | null; import_tax?: number | null; fee?: number | null } | null
): QuoteMoney {
  const subtotal = lineSubtotals.reduce((sum, n) => sum + n, 0)
  const landed = subtotal + freight

  const taxTotal =
    tax && tax.total !== null && tax.total !== undefined
      ? Number(tax.total)
      : null

  const num = (v: unknown): number | null =>
    v === null || v === undefined || !Number.isFinite(Number(v))
      ? null
      : Number(v)

  const dutyTotal = num(ddp?.duty)
  const importTaxTotal = num(ddp?.import_tax)
  const ddpFeeTotal = num(ddp?.fee)
  // What the undertaking adds to the buyer's total. Absent parts count as 0
  // here — but only after each has been recorded as null above, so "nil duty"
  // and "no duty figure" stay distinguishable in what gets frozen and shown.
  const ddpTotal =
    (dutyTotal ?? 0) + (importTaxTotal ?? 0) + (ddpFeeTotal ?? 0)

  return {
    unit_amount: totalUnits > 0 ? subtotal / totalUnits : 0,
    subtotal,
    freight,
    landed_total: landed,
    tax_total: taxTotal,
    /**
     * 🔴 Duty is ADDED in both bases. Unlike tax it is never "already
     * inside" the prices: it is a charge at the destination border that the
     * line prices know nothing about, which is precisely why quoting DDP
     * without adding it took the amount out of our own margin.
     */
    duty_total: dutyTotal,
    import_tax_total: importTaxTotal,
    ddp_fee_total: ddpFeeTotal,
    /**
     * 🔴 When the prices are tax-INCLUSIVE the tax is already inside
     * `landed_total`, so adding it again would overcharge the buyer by the
     * tax. `tax_total` is then the extracted portion — a disclosure, not an
     * addition. Getting this backwards is an 18% error in the confident
     * direction on every Indian quote.
     */
    gross_total:
      taxTotal === null
        ? null
        : (tax?.inclusive ? landed : landed + taxTotal) + ddpTotal,
  }
}

/**
 * PURE: prefer the live tax, fall back to the frozen one.
 *
 * Only substitutes when the live half produced nothing usable — an `unknown`
 * with no reason, which is the default the builder starts from and the exact
 * state a dead link leaves it in. A live answer always wins, including a live
 * `unknown` that carries a reason, because that reason describes the quote as
 * it stands now.
 *
 * Returns the frozen row untouched when there is one, so what renders is what
 * the buyer was told at mint rather than a reconstruction of it.
 */
export function frozenTaxFallback(
  live: QuoteTax,
  quote?: QuoteViewQuote | null
): QuoteTax {
  const liveIsEmpty = live.status === "unknown" && !live.reason
  if (!liveIsEmpty) return live

  const status = quote?.quoted_tax_status
  if (!status) return live

  const total =
    quote?.quoted_tax_total === null || quote?.quoted_tax_total === undefined
      ? null
      : Number(quote.quoted_tax_total)

  return {
    status: status as QuoteTax["status"],
    total,
    inclusive: Boolean(quote?.quoted_tax_inclusive),
    // Not frozen: a rate BREAKDOWN is a live explanation of a live number, and
    // reprinting last week's percentages beside a frozen total invites the
    // reader to re-derive it and find it does not reconcile.
    rates: [],
    reason: quote?.quoted_tax_reason ?? null,
  }
}

/** PURE: the frozen half of the view, or null when nothing was frozen. */
export function frozenMoney(quote?: QuoteViewQuote | null): QuoteMoney | null {
  if (
    !quote ||
    quote.quoted_landed_total === null ||
    quote.quoted_landed_total === undefined
  ) {
    return null
  }
  const totalUnits = (quote.lines || []).reduce(
    (sum, l) => sum + Number(l.quantity ?? 0),
    0
  )
  const subtotal = Number(quote.quoted_subtotal ?? 0)
  const taxTotal =
    quote.quoted_tax_total === null || quote.quoted_tax_total === undefined
      ? null
      : Number(quote.quoted_tax_total)
  const frozenNumber = (v: unknown): number | null =>
    v === null || v === undefined ? null : Number(v)
  const dutyTotal = frozenNumber(quote.quoted_duty_total)
  const importTaxTotal = frozenNumber(quote.quoted_import_tax_total)
  const ddpFeeTotal = frozenNumber(quote.quoted_ddp_fee_total)
  const ddpTotal =
    (dutyTotal ?? 0) + (importTaxTotal ?? 0) + (ddpFeeTotal ?? 0)
  const landed = Number(quote.quoted_landed_total)

  return {
    unit_amount: totalUnits > 0 ? subtotal / totalUnits : 0,
    subtotal,
    freight: Number(quote.quoted_freight ?? 0),
    landed_total: landed,
    /**
     * Null on every quote minted before S8, and that is the honest answer for
     * them: those rows genuinely have no tax figure. Defaulting to 0 would
     * retroactively assert that an untaxed quote was tax-free.
     */
    tax_total: taxTotal,
    /** Same rule, same reason (#1447): null is "no figure", 0 is "nil duty". */
    duty_total: dutyTotal,
    import_tax_total: importTaxTotal,
    ddp_fee_total: ddpFeeTotal,
    gross_total:
      taxTotal === null
        ? null
        : (quote.quoted_tax_inclusive ? landed : landed + taxTotal) + ddpTotal,
  }
}

/**
 * PURE: has the buyer moved away from what was quoted?
 *
 * Drives `show_both` — at which point "what you were quoted" and "what you are
 * looking at" are genuinely different questions rather than the same number
 * printed twice. A line added or removed counts, not just a quantity nudged.
 */
export function buyerChangedInputs(
  quote: QuoteViewQuote | null | undefined,
  effective: {
    lines: BuildQuoteViewLine[]
    destination_postal_code?: string | null
  }
): boolean {
  if (!quote) return false

  const quotedLines = quote.lines || []
  if (quotedLines.length !== effective.lines.length) return true

  const quotedByVariant = new Map(
    quotedLines.map((l) => [l.variant_id, Number(l.quantity ?? 0)])
  )
  for (const line of effective.lines) {
    if (!quotedByVariant.has(line.variant_id)) return true
    if (quotedByVariant.get(line.variant_id) !== Number(line.quantity)) return true
  }

  const quotedPostal = (quote.destination_postal_code ?? "") || ""
  const nowPostal = (effective.destination_postal_code ?? "") || ""
  return quotedPostal !== nowPostal && Boolean(quotedPostal || nowPostal)
}

export async function buildQuoteView(
  scope: any,
  input: BuildQuoteViewInput
): Promise<QuoteView> {
  const query: any = scope.resolve(ContainerRegistrationKeys.QUERY)

  const lifecycle = {
    status: input.quote?.status ?? "active",
    expires_at: input.quote?.expires_at,
  }
  const unusableReason = input.quote
    ? quoteUnusableReason(lifecycle, input.now)
    : null

  const effectiveLines = (input.lines || []).filter(
    (l) => l && l.variant_id && Number(l.quantity) > 0
  )
  if (!effectiveLines.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "A quote needs at least one line with a quantity."
    )
  }

  // ---- Identity ----------------------------------------------------------
  // Fetched even for a dead link: the buyer should still see WHAT was quoted,
  // just without a price they cannot act on.
  const { data: variants } = await query.graph({
    entity: "variant",
    fields: [
      "id",
      "title",
      // #1428: the buyer was looking at a spreadsheet. Variant images first —
      // the product thumbnail is the fallback, not the answer.
      "images.url",
      "images.rank",
      "product.id",
      "product.title",
      "product.handle",
      "product.thumbnail",
      /**
       * Size, from the two places a partner may have stated it.
       *
       * The variant's own option value is the strongest claim — it is the SKU
       * being quoted — and the product's catalogue dimensions are the weakest
       * but cost nothing, since they are already filled in for the "Product
       * information" tab. The middle source is the production spec, resolved
       * separately below. See `quote-size.ts` for the ordering.
       */
      "options.value",
      "options.option.title",
      "product.length",
      "product.width",
      // What the piece IS, for a buyer deciding whether it fits their shelf
      // (#1428 follow-up). Tags are the merchandising vocabulary the catalogue
      // already uses, so they need no new field and cannot drift from it.
      "product.tags.value",
      "product.type.value",
      // 🔴 The type's ID, not just its label. Tax rules are written against
      // `product_type` ids, so without this a product-type-scoped rate can
      // never match and the quote silently falls through to the region
      // default — 5% quoted against 18% charged, on prod.
      "product.type.id",
      "product.collection.title",
    ],
    filters: { id: effectiveLines.map((l) => l.variant_id) },
  })
  const identityById = new Map<string, any>(
    ((variants ?? []) as any[]).map((v) => [v.id, v])
  )
  for (const line of effectiveLines) {
    if (!identityById.has(line.variant_id)) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Variant ${line.variant_id} not found`
      )
    }
  }

  const frozenByVariant = new Map(
    (input.quote?.lines || []).map((l) => [l.variant_id, l])
  )
  const quoted = frozenMoney(input.quote)

  /**
   * The DDP undertaking and its number, resolved ONCE for the whole view.
   *
   * At mint the row does not exist yet, so both arrive on the input; on every
   * later read they come off the frozen quote, which is what stops a re-read
   * from inventing a duty figure the buyer was never shown.
   *
   * 🔴 A duty amount is only ever carried when the quote is actually DDP. A
   * number left behind on a non-DDP quote would be added to a total the buyer
   * was told they pay duty on top of — charging them twice for the same border.
   */
  const dutiesPrepaid = Boolean(
    input.duties_prepaid ?? input.quote?.duties_prepaid
  )
  const frozen = (v: unknown): number | null =>
    v === null || v === undefined ? null : Number(v)

  /**
   * Rates win over amounts, and the INPUT wins over the frozen row.
   *
   * The rates are what make the live column internally consistent: if the buyer
   * moves a quantity, the duty moves with the subtotal it is assessed on. The
   * frozen amounts are never recomputed — `frozenMoney` reads the columns — so
   * "what you were quoted" stays what was quoted.
   */
  const ddpRates = {
    duty_rate_percent:
      input.duty_rate_percent ?? frozen(input.quote?.quoted_duty_rate),
    import_tax_rate_percent:
      input.import_tax_rate_percent ??
      frozen(input.quote?.quoted_import_tax_rate),
  }
  const ddpAmounts = {
    duty_total: input.duty_total ?? frozen(input.quote?.quoted_duty_total),
    import_tax_total:
      input.import_tax_total ?? frozen(input.quote?.quoted_import_tax_total),
    ddp_fee_total:
      input.ddp_fee_total ?? frozen(input.quote?.quoted_ddp_fee_total),
  }
  /** Filled once the live basket is priced; falls back to the frozen figures. */
  let ddpCharges = dutiesPrepaid
    ? {
        duty: ddpAmounts.duty_total,
        import_tax: ddpAmounts.import_tax_total,
        carrier_fee: ddpAmounts.ddp_fee_total,
        duty_rate_percent: ddpRates.duty_rate_percent,
        import_tax_rate_percent: ddpRates.import_tax_rate_percent,
      }
    : {
        duty: null as number | null,
        import_tax: null as number | null,
        carrier_fee: null as number | null,
        duty_rate_percent: null as number | null,
        import_tax_rate_percent: null as number | null,
      }

  let live: QuoteMoney | null = null
  let liveError: string | null = null
  let totalWeightGrams: number | null = null
  let chosen: ShippingEstimateOption | null = null
  /**
   * Did a PERSON name this freight? (#1439 S12)
   *
   * 🔴 A separate flag, and not `chosen.source === "manual"`, because that word
   * is already taken: on a `ShippingEstimateOption`, `source: "manual"` means
   * "a stored flat option" as opposed to `"calculated"`, a live carrier rate.
   * Deriving provenance from it stamped EVERY quote priced off a stored tier —
   * which is most of them, and every cross-border one — as a human's figure.
   * Caught by the control case in the mint integration suite, not by tsc: both
   * readings are the same string.
   */
  let freightOverridden = false
  let options: ShippingEstimateOption[] = []
  let freightError: string | null = null
  /** Set once the lane's rating carrier is resolved; null on a manual-only lane. */
  let ratedBy: string | null = null
  /**
   * Unknown until proven otherwise, and unknown is what a dead or unpriceable
   * link keeps: there is no basket to tax, and a 0 would read as "no tax due".
   */
  let tax: QuoteTax = {
    status: "unknown",
    total: null,
    inclusive: false,
    rates: [],
    reason: null,
  }
  let liveUnitByVariant = new Map<string, number>()
  /**
   * Whether each priced line's amount already contains tax, straight from the
   * pricing module. Folded into ONE answer below — see `pricesTaxInclusive`.
   */
  const priceInclusiveByVariant = new Map<string, boolean>()
  let pricesTaxInclusive: boolean | null = null
  /** Indicative destination charges the BUYER pays. Never part of a total. */
  let importEstimate: QuoteImportEstimate | null = null
  let weightByVariant = new Map<
    string,
    { unit_weight_grams: number; weight_source: "variant" | "product" }
  >()

  /**
   * Where the goods dispatch FROM, resolved before anything is priced.
   *
   * It decides three things that used to be decided separately and could
   * therefore disagree: which carrier rates the lane, whether the sale is an
   * export for tax, and whether a DDP undertaking is even meaningful. S6 makes
   * the location blocking at mint, so by then there is always one to read.
   */
  const originCountry = unusableReason
    ? null
    : await resolveStoreOriginCountry(scope, input.store?.default_location_id)

  if (!unusableReason) {
    try {
      // ---- Price EACH LINE AT ITS OWN QUANTITY --------------------------
      // 🔴 The `quantity` in this context is the entire point — without it the
      // pricing module answers with the qty-1 tier. And it is per line, not
      // per basket: 500 of one product and 20 of another are two different
      // tiers, never one blended rate. See the header.
      for (const line of effectiveLines) {
        const { data: priced } = await query.graph({
          entity: "variant",
          fields: ["id", "calculated_price.*"],
          filters: { id: line.variant_id },
          context: {
            calculated_price: QueryContext({
              ...(input.region_id ? { region_id: input.region_id } : {}),
              currency_code: input.currency_code,
              quantity: line.quantity,
              /**
               * 🔴 THE buyer's group, under the attribute a cart actually
               * carries. Without it `calculated_price` answers with the
               * CATALOGUE price and never sees the price list minted for this
               * buyer — so a quote with a negotiated trade price rendered its
               * own retail number as "what it costs today", told the buyer
               * pricing had moved, and showed a delta of the entire discount.
               * Minutes after minting, with nothing having moved.
               *
               * Invisible on a quote priced at catalogue, where live and quoted
               * agree by coincidence — i.e. on every quote except the B2B ones
               * this whole epic exists for.
               *
               * `customer.groups.id`, not `customer_group_id`: the latter
               * matches nothing, which is the #1389 defect that made the first
               * minted quote price nothing at all.
               */
              ...(input.customer_group_id
                ? { [QUOTE_GROUP_RULE_ATTRIBUTE]: [input.customer_group_id] }
                : {}),
            }),
          },
        })
        const unitAmount = Number(
          (priced?.[0] as any)?.calculated_price?.calculated_amount
        )
        if (!Number.isFinite(unitAmount)) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `No price for variant ${line.variant_id} in ${input.currency_code} at quantity ${line.quantity}`
          )
        }
        liveUnitByVariant.set(line.variant_id, unitAmount)
        priceInclusiveByVariant.set(
          line.variant_id,
          Boolean(
            (priced?.[0] as any)?.calculated_price
              ?.is_calculated_price_tax_inclusive
          )
        )
      }

      // ---- Who rates this lane -------------------------------------------
      // 🔴 The estimate used to default to Shiprocket for every partner quote
      // ever minted, so a partner who ships Delhivery was quoted freight by a
      // company they do not use. The number was plausible — a real rate, real
      // lane, wrong carrier — which is why it survived. Their enabled carriers
      // are the location's provider links, the same fact core reads at
      // fulfilment time.
      const enabledCarrierIds = await readEnabledCarrierIds(
        scope,
        input.store?.default_location_id
      )
      const ratingCarrier =
        pickRatingCarrier({
          explicit: input.carrier,
          enabledCarrierIds,
          lane:
            classifyQuoteJurisdiction(
              originCountry,
              input.destination_country_code
            ) === "domestic"
              ? "domestic"
              : "international",
        }) ?? undefined
      ratedBy =
        ratingCarrier && ratingCarrier !== "manual" && ratingCarrier !== "none"
          ? ratingCarrier
          : ratingCarrier
            ? null
            : "shiprocket"

      // ---- Freight: ONE consignment, summed weight -----------------------
      const estimate = await buildShippingEstimate(scope, {
        lines: effectiveLines.map((l) => ({
          variant_id: l.variant_id,
          quantity: l.quantity,
        })),
        destination_postal_code: String(input.destination_postal_code ?? ""),
        country_code: input.destination_country_code,
        // Without this the manual options are compared across currencies and
        // the cheapest NUMBER wins regardless of unit — a 10 AUD European
        // option beat a rupee rate on a live Mumbai quote.
        currency_code: input.currency_code,
        carrier: ratingCarrier,
        store: input.store,
      })
      totalWeightGrams = estimate.total_weight_grams
      freightError = estimate.calculated_error
      options = [...estimate.calculated, ...estimate.manual]
      chosen = pickFreightOption(estimate)
      weightByVariant = new Map(
        estimate.lines.map((l) => [
          l.variant_id,
          {
            unit_weight_grams: l.unit_weight_grams,
            weight_source: l.weight_source,
          },
        ])
      )

      /**
       * A hand-named freight amount wins over whatever the picker found
       * (#1439 S12).
       *
       * 🔑 It REPLACES the amount and keeps everything else. The lane, the
       * consignment weight and the option list are still computed and still
       * shown, because they are what lets a human check the typed number — an
       * override rendered with no context is a figure nobody can challenge.
       *
       * 🔴 It also satisfies the "no freight option" refusal below. That
       * refusal exists so a landed total can never be missing its freight leg;
       * an override is freight, so the reason for refusing is gone. This is the
       * half that unblocks the lanes where the carrier answers "no serviceable
       * couriers" — today, that is every cross-border lane.
       */
      const overrideAmount =
        input.freight_override_amount === null ||
        input.freight_override_amount === undefined ||
        !Number.isFinite(Number(input.freight_override_amount))
          ? null
          : Number(input.freight_override_amount)

      if (overrideAmount !== null) {
        freightOverridden = true
        chosen = {
          // Named for what it is. A buyer reading "International Shipping" on a
          // number a person typed would reasonably think a carrier quoted it.
          name: "Freight (quoted by hand)",
          amount: overrideAmount,
          currency_code: input.currency_code,
          source: "manual",
          // Deliberately carried over: the accepted cart builds its freight
          // option in the service zone of the option this quote was rated
          // against (#1439 S11), and an overridden amount still ships on that
          // lane. Null when nothing was quotable, which acceptance refuses —
          // see the watch-out on #1450.
          shipping_option_id: chosen?.shipping_option_id,
        } as typeof chosen
      }

      if (!chosen) {
        // A landed total with no freight in it is a wrong number wearing a
        // confident label. Better to have no live half at all.
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          freightError
            ? `No freight option could be quoted for this lane: ${freightError}. ` +
                `Name the freight by hand to quote it anyway.`
            : "No freight option could be quoted for this lane. " +
                "Name the freight by hand to quote it anyway."
        )
      }

      // Tax LAST, because it is a function of the priced lines and the chosen
      // freight leg — both of which only exist at this point. It never throws;
      // an unresolvable rate lands on `status: "unknown"` with a reason rather
      // than on a zero. The origin was read above, off the same stock location
      // the freight leg was quoted against, so the tax treatment and the
      // shipment cannot describe two different journeys.

      /**
       * ALL, not ANY, and null when nothing was priced.
       *
       * 🔑 The two ways to be wrong are not symmetric. Treating inclusive
       * prices as exclusive OVER-quotes: the buyer sees a bigger number, the
       * cart disagrees, and acceptance is refused loudly. Treating exclusive
       * prices as inclusive UNDER-quotes: we extract tax out of a price that
       * never contained it and are silently underpaid. So a mixed basket —
       * which should not exist — resolves to exclusive, taking the failure
       * that shouts over the one that costs money.
       */
      const inclusiveFlags = effectiveLines
        .map((l) => priceInclusiveByVariant.get(l.variant_id))
        .filter((v): v is boolean => typeof v === "boolean")
      pricesTaxInclusive = inclusiveFlags.length
        ? inclusiveFlags.every(Boolean)
        : null

      tax = await resolveQuoteTax(scope, {
        region_id: input.region_id ?? null,
        prices_tax_inclusive: pricesTaxInclusive,
        origin_country_code: originCountry,
        // Mint supplies it directly; a later page read takes it off the frozen
        // row, so the buyer sees the same promise on every visit.
        duties_prepaid: dutiesPrepaid,
        destination_country_code: input.destination_country_code,
        destination_postal_code: input.destination_postal_code ?? null,
        lines: effectiveLines.map((l) => ({
          variant_id: l.variant_id,
          product_id: identityById.get(l.variant_id)?.product?.id ?? null,
          product_type_id:
            identityById.get(l.variant_id)?.product?.type?.id ?? null,
          unit_amount: liveUnitByVariant.get(l.variant_id) ?? 0,
          quantity: l.quantity,
        })),
        freight: { amount: Number(chosen.amount), option_id: chosen.shipping_option_id ?? null },
      })

      const liveSubtotals = effectiveLines.map(
        (l) => (liveUnitByVariant.get(l.variant_id) ?? 0) * l.quantity
      )

      /**
       * What the buyer will meet at their own border. Computed here because
       * the priced lines and the chosen freight both exist by now, and
       * deliberately AFTER `liveSubtotals` so the basis is the same goods total
       * the buyer is looking at.
       *
       * 🔑 Never folded into `live` or `quoted`. It is not ours to charge and
       * not ours to collect — putting it in a total would restate the exact
       * error we just removed from the cart.
       */
      importEstimate = await resolveBuyerImportEstimate(scope, {
        origin_country_code: originCountry,
        destination_country_code: input.destination_country_code,
        destination_postal_code: input.destination_postal_code ?? null,
        duties_prepaid: dutiesPrepaid,
        subtotal: liveSubtotals.reduce((sum, n) => sum + n, 0),
        freight: Number(chosen.amount),
      })

      if (dutiesPrepaid) {
        /**
         * 🔴 The amounts are computed HERE, from the basket that was actually
         * priced — never taken from the client. A wizard can only estimate the
         * subtotal and cannot know the freight at all before this runs, so a
         * client-computed figure would be a guess frozen as a commitment.
         *
         * Duty on goods + freight; import tax on goods + freight + duty. The
         * cascade is the arithmetic people get wrong by hand, and the error
         * always lands the same way: under-funding a promise we then eat.
         */
        const charges = computeDdpCharges({
          subtotal: liveSubtotals.reduce((sum, n) => sum + n, 0),
          freight: Number(chosen.amount),
          ...ddpRates,
          ...ddpAmounts,
        })
        ddpCharges = {
          duty: charges.duty,
          import_tax: charges.import_tax,
          carrier_fee: charges.carrier_fee,
          duty_rate_percent: charges.duty_rate_percent,
          import_tax_rate_percent: charges.import_tax_rate_percent,
        }
      }

      live = composeQuoteMoney(
        liveSubtotals,
        effectiveLines.reduce((sum, l) => sum + l.quantity, 0),
        Number(chosen.amount),
        tax,
        // Nobody can price this lane's duty from a carrier API yet (see the
        // model docblock), so these are the partner's rates applied to the real
        // basket — carried into the total so the promise is actually funded.
        dutiesPrepaid
          ? {
              duty: ddpCharges.duty,
              import_tax: ddpCharges.import_tax,
              fee: ddpCharges.carrier_fee,
            }
          : null
      )
    } catch (err) {
      // The quoted half — what the partner actually told this buyer — is still
      // worth showing when the live half cannot be built.
      liveError = err instanceof Error ? err.message : String(err)
      live = null
    }
  }

  // Both of these are enrichment, resolved after the money and deliberately
  // unable to fail the view.
  /**
   * The product's OTHER colourways/sizes, for the buyer's information only
   * (#1439 S14).
   *
   * 🔴 Deliberately NOT a configurator, and it must never become one. A quote
   * is frozen against specific variants at specific prices, so a picker the
   * buyer cannot act on is worse than no picker — the same reasoning that keeps
   * option groups out of `spec`. This states what the maker also weaves,
   * answering "can I get this in indigo?" with a fact instead of a round trip,
   * and the only action it implies is replying to the partner.
   *
   * 🔑 A SEPARATE query on purpose. `product.variants.id` requested from the
   * `variant` entity resolves to nothing — the back-reference does not traverse
   * that way — and it fails by returning an empty array, not by erroring, so
   * the badges would simply never have rendered and nothing would have said
   * why. Caught by `partner-quote-line-imagery.spec.ts`.
   *
   * Enrichment, like the specs below it: a failure here must not cost the buyer
   * their prices.
   */
  const productIds = [
    ...new Set(
      effectiveLines
        .map((l) => identityById.get(l.variant_id)?.product?.id)
        .filter(Boolean)
    ),
  ]
  const siblingsByProduct = new Map<string, Array<{ id: string; title: string | null }>>()
  if (productIds.length) {
    try {
      const { data: products } = await query.graph({
        entity: "product",
        fields: ["id", "variants.id", "variants.title"],
        filters: { id: productIds },
      })
      for (const product of (products ?? []) as any[]) {
        siblingsByProduct.set(
          product.id,
          ((product.variants ?? []) as any[])
            .filter((v) => v?.id)
            .map((v) => ({ id: String(v.id), title: v.title ?? null }))
        )
      }
    } catch (e: any) {
      // Enrichment: the badges vanish, the prices do not. Logged so a
      // permanently-empty sibling list is diagnosable rather than assumed to
      // mean "this product has one variant".
      const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)
      logger?.warn?.(
        `[quote] sibling variants unavailable: ${e?.message ?? String(e)}`
      )
    }
  }

  const specByProduct = await resolveQuoteSpecs(
    scope,
    effectiveLines
      .map((l) => identityById.get(l.variant_id)?.product?.id)
      .filter(Boolean)
  )

  const lines: QuoteViewLine[] = effectiveLines.map((line, index) => {
    const identity = identityById.get(line.variant_id)
    const frozen = frozenByVariant.get(line.variant_id)
    const liveUnit = live ? liveUnitByVariant.get(line.variant_id) ?? null : null
    const weight = weightByVariant.get(line.variant_id)

    return {
      variant_id: line.variant_id,
      variant_title: identity.title ?? null,
      product_id: identity.product?.id ?? null,
      product_title: identity.product?.title ?? null,
      product_handle: identity.product?.handle ?? null,
      ...pickLineImage(identity),
      images: lineImages(identity),
      other_variants: (siblingsByProduct.get(identity.product?.id) ?? []).filter(
        // 🔴 The quoted variant is never its own alternative. Listing it beside
        // the others reads as a choice the buyer still has, when the price is
        // frozen against exactly this one.
        (v) => v.id !== line.variant_id
      ),
      spec: specByProduct.get(identity.product?.id) ?? null,
      /**
       * "How big is it" — the question a buyer approving a consignment asks
       * before any of the weave numbers. Resolved from the strongest source
       * that has an answer, and the source travels with it so the page can
       * caveat a product-level claim on a variant-specific line.
       */
      size: resolveLineSize({
        variant: identity,
        spec_size: specByProduct.get(identity.product?.id)?.size ?? null,
        product: identity.product,
      }),
      product_tags: ((identity.product?.tags ?? []) as any[])
        .map((t) => t?.value)
        .filter((v: any): v is string => typeof v === "string" && v.length > 0),
      product_type: identity.product?.type?.value ?? null,
      product_type_id: identity.product?.type?.id ?? null,
      product_collection: identity.product?.collection?.title ?? null,
      quantity: line.quantity,
      quoted_quantity:
        frozen?.quantity === undefined || frozen?.quantity === null
          ? null
          : Number(frozen.quantity),
      position: line.position ?? frozen?.position ?? index,
      note: line.note ?? frozen?.note ?? null,
      // #1486 — carried through so the frozen row, both partner UIs and the
      // buyer's page can say "this is your Kashida Shawl" rather than showing
      // a SKU for a piece the buyer knows by name. It prices nothing.
      design_id: line.design_id ?? frozen?.design_id ?? null,
      live_unit_amount: liveUnit,
      live_subtotal: liveUnit === null ? null : liveUnit * line.quantity,
      quoted_unit_amount:
        frozen?.quoted_unit_amount === undefined || frozen?.quoted_unit_amount === null
          ? null
          : Number(frozen.quoted_unit_amount),
      quoted_subtotal:
        frozen?.quoted_subtotal === undefined || frozen?.quoted_subtotal === null
          ? null
          : Number(frozen.quoted_subtotal),
      unit_weight_grams:
        weight?.unit_weight_grams ?? frozen?.quoted_unit_weight_grams ?? null,
      weight_source: weight?.weight_source ?? frozen?.quoted_weight_source ?? null,
    }
  })

  // Resolved AFTER the money, and deliberately unable to fail the view: a
  // credit line is not worth a buyer's 500. Returns null whenever we cannot
  // positively tell that the viewer is off the partner's own storefront.
  // The catalogue's own words for what is in this basket, deduped once and
  // shared by the producer band and the reseller block.
  const basketTags = Array.from(
    new Set(lines.flatMap((l) => l.product_tags ?? []))
  ).sort((a, b) => a.localeCompare(b))

  const producer = await resolveQuoteProducer(scope, {
    partner_id: input.partner_id ?? null,
    viewer_sales_channel_ids: input.viewer_sales_channel_ids ?? null,
    product_tags: basketTags,
  })

  // Same contract as the producer band: resolved after the money and unable to
  // fail the view. A maker credit is not worth a buyer's 500.
  const provenance = await resolveQuoteProvenance(scope, {
    partner_id: input.partner_id ?? null,
    product_ids: lines.map((l) => l.product_id),
  })

  /**
   * The reseller's view: the shop's own price beside the buyer's.
   *
   * 🔴 Priced WITHOUT the customer group, deliberately — that is the whole
   * difference between "what you pay" and "what it lists at". Best-effort per
   * line: a list price we cannot resolve is simply absent, never zero, and the
   * block disappears entirely rather than reporting a margin of nothing.
   *
   * Only attempted on a read (`customer_group_id` present). At mint there is no
   * group and the two prices are the same number, so there is nothing to say.
   */
  const listPrices = new Map<string, number>()
  if (!unusableReason && input.customer_group_id) {
    for (const line of effectiveLines) {
      try {
        const { data: listed } = await query.graph({
          entity: "variant",
          fields: ["id", "calculated_price.*"],
          filters: { id: line.variant_id },
          context: {
            calculated_price: QueryContext({
              ...(input.region_id ? { region_id: input.region_id } : {}),
              currency_code: input.currency_code,
              // Quantity 1: a list price is what ONE costs a walk-up buyer.
              // Passing the quoted quantity would hand back a bulk tier and
              // quietly understate the spread the buyer is actually getting.
              quantity: 1,
            }),
          },
        })
        const amount = Number(
          (listed?.[0] as any)?.calculated_price?.calculated_amount
        )
        if (Number.isFinite(amount)) listPrices.set(line.variant_id, amount)
      } catch {
        // A missing list price costs the buyer nothing. It must never cost
        // them the page.
      }
    }
  }

  const retail = composeQuoteRetail({
    currency_code: input.currency_code,
    lines: lines.map((l) => ({
      variant_id: l.variant_id,
      product_title: l.product_title,
      quantity: l.quantity,
      unit_amount: l.live_unit_amount ?? l.quoted_unit_amount,
      product_tags: l.product_tags,
    })),
    listPrices,
  })

  /**
   * The maker's own words, attached to the band that names them.
   *
   * 🔑 Read off the provenance rather than resolved again — `maker_story` comes
   * from the product's `artisan_product_detail`, and asking twice is how one
   * question gets two answers. ⚠️ Neither the partner model nor
   * `partner_onboarding_profile` carries prose; the profile is structured facts
   * and those are already the provenance ROWS. A maker with no artisan detail
   * therefore has no story, and the band shows tags alone rather than a
   * paragraph assembled out of their team size.
   */
  const producerWithStory = producer
    ? { ...producer, story: provenance?.maker_story ?? null }
    : null

  /**
   * The assurance block. Built from what has already been resolved above —
   * producer, provenance, the money, the tax verdict and the duty undertaking
   * — so it cannot disagree with the numbers it sits beside.
   *
   * 🔴 `cross_border` decides whether import duty is even mentioned, and it is
   * the ORIGIN against the DESTINATION. Getting this from the buyer's country
   * alone would tell a Mumbai buyer on an Indian lane that duty is payable on
   * arrival, which is both false and alarming.
   */
  const assurance = composeQuoteAssurance({
    currency_code: input.currency_code,
    producer: producerWithStory,
    provenance,
    money: live ?? quoted,
    tax: frozenTaxFallback(tax, input.quote),
    duty: {
      prepaid: dutiesPrepaid,
      total: ddpCharges.duty,
      import_tax: ddpCharges.import_tax,
      carrier_fee: ddpCharges.carrier_fee,
    },
    cross_border: Boolean(
      originCountry &&
        input.destination_country_code &&
        originCountry.toUpperCase() !==
          String(input.destination_country_code).toUpperCase()
    ),
    expires_in_days: input.quote ? daysUntilExpiry(lifecycle, input.now) : null,
  })

  const compare = compareQuote({
    quoted,
    live,
    buyer_changed_inputs: buyerChangedInputs(input.quote, {
      lines: effectiveLines,
      destination_postal_code: input.destination_postal_code,
    }),
    unusable_reason: unusableReason,
    days_until_expiry: input.quote
      ? daysUntilExpiry(lifecycle, input.now)
      : null,
  })

  return {
    lines: lines.sort((a, b) => a.position - b.position),
    currency_code: input.currency_code,
    destination_country_code: input.destination_country_code,
    destination_postal_code: input.destination_postal_code ?? null,
    live,
    quoted,
    total_weight_grams:
      totalWeightGrams ?? input.quote?.quoted_weight_grams ?? null,
    freight: {
      chosen,
      options,
      error: freightError,
      rated_by: ratedBy,
      overridden: freightOverridden,
    },
    /**
     * Live tax where there is one; the FROZEN tax on a dead link.
     *
     * 🔴 The live block is skipped entirely when `unusableReason` is set, which
     * left `tax` on its `{status:"unknown", reason:null}` default for every
     * revoked, superseded and expired quote. The page renders its notice only
     * when there IS a reason, so those quotes showed frozen subtotal and
     * freight and NO tax block at all — the "a missing tax block reads as no
     * tax due" failure this module was written to prevent, landing on exactly
     * the quotes that exist as evidence of what was said.
     *
     * Falling back to the frozen row shows what the buyer was actually told,
     * which is the same reasoning that keeps the frozen totals visible on a
     * dead link rather than recomputing a number we are no longer offering.
     */
    tax: frozenTaxFallback(tax, input.quote),
    prices_tax_inclusive: pricesTaxInclusive,
    import_estimate: importEstimate,
    duty: {
      prepaid: dutiesPrepaid,
      total: ddpCharges.duty,
      import_tax: ddpCharges.import_tax,
      carrier_fee: ddpCharges.carrier_fee,
      combined_total: dutiesPrepaid
        ? (ddpCharges.duty ?? 0) +
          (ddpCharges.import_tax ?? 0) +
          (ddpCharges.carrier_fee ?? 0)
        : null,
      duty_rate_percent: ddpCharges.duty_rate_percent,
      import_tax_rate_percent: ddpCharges.import_tax_rate_percent,
      // Gated on the undertaking for the same reason the amount is: a basis
      // note on a quote that is not DDP describes a promise nobody made.
      basis: dutiesPrepaid
        ? (input.duty_basis ?? input.quote?.quoted_duty_basis ?? null)
        : null,
    },
    compare,
    recipient: {
      name: input.quote?.recipient_name ?? null,
      company: input.quote?.recipient_company ?? null,
      partner_note: input.quote?.partner_note ?? null,
    },
    producer: producerWithStory,
    provenance,
    retail,
    assurance,
    expires_in_days: input.quote ? daysUntilExpiry(lifecycle, input.now) : null,
    origin_country_code: originCountry,
    live_error: liveError,
  }
}
