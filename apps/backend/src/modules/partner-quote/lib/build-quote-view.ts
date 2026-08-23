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
import { resolveQuoteTax, type QuoteTax } from "./quote-tax"
import { computeDdpCharges, describeDdpBasis } from "./ddp-charges"
import {
  pickRatingCarrier,
  readEnabledCarrierIds,
} from "../../shipping-providers/rating-carrier"
import { classifyQuoteJurisdiction } from "./quote-tax"
import { resolveQuoteSpecs, type QuoteLineSpec } from "./quote-spec"
import { daysUntilExpiry, quoteUnusableReason } from "./token"

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
  quantity: number
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
 */
export function pickFreightOption(
  estimate: Pick<ShippingEstimate, "manual" | "calculated">
): ShippingEstimateOption | null {
  const all = [...(estimate.calculated || []), ...(estimate.manual || [])]
    .filter((o) => Number.isFinite(Number(o?.amount)))
    .sort((a, b) => Number(a.amount) - Number(b.amount))
  return all[0] ?? null
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

      tax = await resolveQuoteTax(scope, {
        region_id: input.region_id ?? null,
        origin_country_code: originCountry,
        // Mint supplies it directly; a later page read takes it off the frozen
        // row, so the buyer sees the same promise on every visit.
        duties_prepaid: dutiesPrepaid,
        destination_country_code: input.destination_country_code,
        destination_postal_code: input.destination_postal_code ?? null,
        lines: effectiveLines.map((l) => ({
          variant_id: l.variant_id,
          product_id: identityById.get(l.variant_id)?.product?.id ?? null,
          unit_amount: liveUnitByVariant.get(l.variant_id) ?? 0,
          quantity: l.quantity,
        })),
        freight: { amount: Number(chosen.amount), option_id: chosen.shipping_option_id ?? null },
      })

      const liveSubtotals = effectiveLines.map(
        (l) => (liveUnitByVariant.get(l.variant_id) ?? 0) * l.quantity
      )

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
      spec: specByProduct.get(identity.product?.id) ?? null,
      quantity: line.quantity,
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
  const producer = await resolveQuoteProducer(scope, {
    partner_id: input.partner_id ?? null,
    viewer_sales_channel_ids: input.viewer_sales_channel_ids ?? null,
  })

  // Same contract as the producer band: resolved after the money and unable to
  // fail the view. A maker credit is not worth a buyer's 500.
  const provenance = await resolveQuoteProvenance(scope, {
    partner_id: input.partner_id ?? null,
    product_ids: lines.map((l) => l.product_id),
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
    producer,
    provenance,
    expires_in_days: input.quote ? daysUntilExpiry(lifecycle, input.now) : null,
    origin_country_code: originCountry,
    live_error: liveError,
  }
}
