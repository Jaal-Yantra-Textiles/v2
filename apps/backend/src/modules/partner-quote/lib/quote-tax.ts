import {
  calculateAmountsWithTax,
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"

/**
 * Tax on a quote (#1439 S8).
 *
 * ## What was wrong
 *
 * `composeQuoteMoney` was literally `subtotal + freight`, and grep for "tax"
 * across the whole quote path returned nothing. "Landed" here meant goods plus
 * freight — no GST, no VAT, no duty. A B2B buyer shown a "landed cost" with no
 * tax in it is being shown a number they cannot budget against.
 *
 * ## Why this calls the Tax module rather than doing arithmetic
 *
 * A cart gets `tax_lines` for free once it has a shipping address. A quote has
 * no cart and no address — only a destination country and postal code, and
 * deliberately so: asking a procurement contact for address line 1 before they
 * have a price is the wall this feature exists to remove. So the context is
 * synthesized and handed to the same module a cart would use.
 *
 * 🔑 That is not a convenience, it is the requirement. S11 turns an accepted
 * quote into a cart, and the cart will ask the Tax module with the real
 * address. If this file computed its own percentages, the quote and the cart
 * would disagree the first time a rate had a rule on it. For the same reason
 * the totals go through core's own `calculateTaxTotal` — matching its rounding
 * is the only way two numbers stay equal.
 *
 * ## Never a confident zero
 *
 * A destination with no configured tax region returns `status: "unknown"` and
 * a `reason` the page is expected to RENDER. Zero is a claim; "we do not know"
 * is the truth, and the difference is exactly how #1430 shipped bulk orders
 * with free freight. `total` stays null in every non-calculated state so a
 * caller cannot accidentally add it to anything.
 */

export type QuoteTaxRate = {
  code: string | null
  name: string
  /** Percentage, as the Tax module reports it (18 means 18%). */
  rate: number
  /** Which leg it applied to — a buyer asks about freight tax separately. */
  on: "goods" | "freight"
}

export type QuoteTax = {
  /**
   * - `calculated`: `total` is real.
   * - `zero_rated_export`: the goods leave the seller's jurisdiction, so the
   *   seller charges no tax. `total` is a REAL 0, not a missing number — but
   *   duty and import tax fall on the buyer at their border and are not in it,
   *   which is why `reason` is still populated and still has to be rendered.
   * - `not_applicable`: the region does not calculate tax automatically, so
   *   neither does the cart. Nothing is owed HERE, which is different from
   *   nothing being owed at all.
   * - `unknown`: no rate is configured, or the origin could not be established.
   *   Say so.
   */
  status: "calculated" | "zero_rated_export" | "not_applicable" | "unknown"
  /** Null unless `calculated`. Never 0 as a stand-in for "we do not know". */
  total: number | null
  /**
   * True when the quoted prices ALREADY contain the tax — in which case
   * `total` is extracted from the subtotal rather than added to it.
   */
  inclusive: boolean
  rates: QuoteTaxRate[]
  /** Rendered verbatim by the page whenever status is not `calculated`. */
  reason: string | null
}

export type QuoteTaxInput = {
  region_id?: string | null
  /**
   * Where the goods DISPATCH from — the partner store's default stock location
   * country. Required to decide domestic vs export; without it the answer is
   * `unknown`, never a destination-rate guess.
   *
   * S6's readiness gate makes `store.default_location_id` blocking, so a quote
   * that got as far as tax always has one.
   */
  origin_country_code?: string | null
  /**
   * The partner has undertaken to pay the destination duty and import tax on
   * this quote (DDP), so the buyer owes nothing on arrival.
   *
   * Per-quote and never a default: it is a promise that only holds if the
   * shipment actually clears DDP — by the carrier when one supports it, or
   * arranged by hand until then.
   */
  duties_prepaid?: boolean
  destination_country_code: string
  destination_postal_code?: string | null
  destination_province_code?: string | null
  /**
   * Whether the PRICES this quote is built from already contain tax, read off
   * the pricing module's own `is_calculated_price_tax_inclusive`.
   *
   * 🔴 This is not the same question as `region.is_tax_inclusive`, which is
   * what this used to ask. On prod both regions are `null` while every
   * calculated price answers `true` — so the quote added tax on top of a price
   * that already contained it, and the cart later extracted it back out. The
   * two disagreed by the whole tax amount and acceptance was refused outright:
   * ₹90,000 quoted against a cart subtotal of ₹76,271.19, which is exactly
   * ₹90,000 / 1.18.
   *
   * Null means "not established" and falls back to the region flag, which is
   * the old behaviour and still right for callers that price nothing.
   */
  prices_tax_inclusive?: boolean | null
  lines: Array<{
    variant_id: string
    product_id?: string | null
    /**
     * 🔴 The product's TYPE, because that is what tax rules are written
     * against. Omitting it did not fail — it silently fell through to the
     * region's default rate, so a prod rate named "India apparel/textile GST
     * (>₹2,500)" at 18%, scoped by `product_type`, could never match and every
     * quote was taxed at the 5% default while the cart charged 18%.
     *
     * Same shape as #1430: a rule that is never read cannot be seen to be
     * missing, because the fallback is a plausible number.
     */
    product_type_id?: string | null
    unit_amount: number
    quantity: number
  }>
  /** The one freight leg, already chosen. Null when none could be quoted. */
  freight?: { amount: number; option_id?: string | null } | null
}

/** The shape `getTaxLines` answers with, narrowed to what is used here. */
type RawTaxLine = {
  rate?: number
  code?: string | null
  name?: string
  line_item_id?: string
  shipping_line_id?: string
}

/**
 * PURE: fold the module's per-line rates into one total and a rate summary.
 *
 * Amounts come from core's `calculateAmountsWithTax`, not from
 * `amount * rate / 100`, so the rounding is the rounding the cart will use.
 *
 * 🔴 NOT `calculateTaxTotal` — read its source before reaching for it. Passed
 * `isTaxInclusive: true` it returns **0** and does no work: in core, an
 * inclusive item's tax is extracted by `calculateAmountsWithTax`, which divides
 * the gross by (1 + rate) to recover the taxable base first. Trusting the
 * name would have reported ZERO TAX on every tax-inclusive quote — silently,
 * and in the confident direction. A unit test caught it; nothing else would
 * have.
 */
export function foldTaxLines(
  taxable: Array<{
    id: string
    amount: number
    on: "goods" | "freight"
  }>,
  lines: RawTaxLine[],
  isTaxInclusive: boolean
): { total: number; rates: QuoteTaxRate[] } {
  const byId = new Map<string, RawTaxLine[]>()
  for (const l of lines || []) {
    const key = l.line_item_id ?? l.shipping_line_id ?? ""
    if (!key) continue
    byId.set(key, [...(byId.get(key) ?? []), l])
  }

  let total = 0
  const rates: QuoteTaxRate[] = []
  const seen = new Set<string>()

  for (const item of taxable) {
    const applicable = byId.get(item.id) ?? []
    if (!applicable.length) continue

    const { priceWithTax, priceWithoutTax } = calculateAmountsWithTax({
      taxLines: applicable.map((l) => ({ rate: Number(l.rate ?? 0) })),
      amount: item.amount,
      includesTax: isTaxInclusive,
    })
    // The difference, either way round: added on top when exclusive, carved
    // out of the price when inclusive.
    total += Number(priceWithTax) - Number(priceWithoutTax)

    for (const l of applicable) {
      // One entry per distinct rate PER LEG: "18% GST on goods" and "18% GST
      // on freight" are two facts a buyer reads separately, even at the same
      // percentage.
      const key = `${item.on}:${l.code ?? ""}:${l.rate ?? 0}`
      if (seen.has(key)) continue
      seen.add(key)
      rates.push({
        code: l.code ?? null,
        name: l.name ?? "Tax",
        rate: Number(l.rate ?? 0),
        on: item.on,
      })
    }
  }

  // Money, to two places — the same shape every other amount here carries.
  return { total: Math.round(total * 100) / 100, rates }
}

/**
 * PURE: domestic supply, cross-border export, or not enough information.
 *
 * ## Why the seller's jurisdiction decides this and the buyer's does not
 *
 * The first cut of this file asked the Tax module using the DESTINATION country
 * alone, which quietly assumed the seller is registered wherever the buyer
 * happens to be. On this platform the goods always dispatch from India, so a
 * German buyer was being shown 19% German VAT on an Indian export invoice — a
 * fifth added to the headline number, on every EU quote. It over-quoted rather
 * than under-quoted, so it lost deals instead of money, but it was never right.
 *
 * The structure it has to model: JYT (India) is the supplier and the shipper.
 * Kind Health Tech SIA invoices and collects on JYT's behalf for non-Indian
 * buyers, which makes it a disclosed agent, not a second seller — the supply is
 * still JYT's, still dispatched from India. KHT is also not VAT-registered
 * (below the Latvian threshold), so no EU VAT arises through it either. An
 * export is therefore zero-rated at origin whatever route the invoice takes.
 *
 * `unknown_origin` is deliberately NOT "assume domestic". Assuming would put a
 * confident 18% on a quote we cannot place, which is the same failure as the
 * confident zero this module was written to stop — only in the other direction.
 */
export function classifyQuoteJurisdiction(
  originCountryCode?: string | null,
  destinationCountryCode?: string | null
): "domestic" | "export" | "unknown_origin" {
  const origin = String(originCountryCode || "").trim().toUpperCase()
  const destination = String(destinationCountryCode || "").trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(origin) || !/^[A-Z]{2}$/.test(destination)) {
    return "unknown_origin"
  }
  return origin === destination ? "domestic" : "export"
}

/**
 * PURE: the wording on a zero-rated export.
 *
 * 🔴 The zero here is real and the sentence after it is the important half. The
 * buyer is importer of record: their customs authority will charge import VAT
 * and duty before the goods are released, neither of which is in this total.
 * Import VAT a business reclaims; duty it does not. A procurement contact who
 * budgets against a number labelled "landed" and then meets a customs bill has
 * been misled by us, which is #1430's shape exactly — a confident figure that
 * omits a real charge.
 */
export function exportDisclosureReason(
  originCountryCode: string,
  destinationCountryCode: string,
  dutiesPrepaid = false
): string {
  const from = String(originCountryCode || "").toUpperCase()
  const to = String(destinationCountryCode || "").toUpperCase()
  const zeroRated =
    `This is an export from ${from} to ${to}, so it is zero-rated and no ` +
    `seller tax is charged.`

  if (dutiesPrepaid) {
    // 🔴 This sentence is a PROMISE, and it is the only one on the page we
    // cannot keep from software alone: the shipment has to actually clear DDP,
    // by the carrier or by hand. It is therefore per-quote and frozen, never a
    // global setting — a default that silently applied to a quote nobody
    // arranged clearance for would tell a buyer there is nothing to pay and
    // then hand them a customs bill.
    return (
      `${zeroRated} Import duty and taxes are included in this price and are ` +
      `paid by us — there is nothing further to pay on delivery.`
    )
  }

  return (
    `${zeroRated} Import duty and import VAT/GST are payable by you ` +
    `to ${to} customs on arrival and are NOT included in this total.`
  )
}

/** PURE: the wording when the goods' origin cannot be established. */
export function unknownOriginReason(destinationCountryCode: string): string {
  const to = String(destinationCountryCode || "").toUpperCase()
  return (
    `We could not establish which country these goods ship from, so the tax ` +
    `treatment for ${to || "this destination"} cannot be determined. This ` +
    `total excludes tax, duty and import charges.`
  )
}

/** PURE: the wording a buyer sees when there is no number to show them. */
export function unknownTaxReason(countryCode: string): string {
  const cc = String(countryCode || "").toUpperCase()
  return (
    `No tax rate is configured for ${cc || "this destination"}, so this total ` +
    `excludes tax. Any duty or import tax due on arrival is not included.`
  )
}

const NOT_APPLICABLE_REASON =
  "This destination's region does not apply tax automatically, so no tax is " +
  "included. Any duty or import tax due on arrival is not included."

/**
 * Resolve the tax on a quote.
 *
 * Never throws. Tax is one block on a page that is mostly about a price, and a
 * misconfigured region must not 500 a buyer's quote — but unlike the producer
 * band, silence is NOT an acceptable degradation here, because a missing tax
 * block reads as "no tax". Every failure lands on `unknown` WITH a reason.
 */
export async function resolveQuoteTax(
  scope: any,
  input: QuoteTaxInput
): Promise<QuoteTax> {
  const country = String(input.destination_country_code || "").toLowerCase()

  const base: QuoteTax = {
    status: "unknown",
    total: null,
    inclusive: false,
    rates: [],
    reason: unknownTaxReason(country),
  }

  if (!country) return base

  // ---- Whose tax is it, before asking how much ---------------------------
  // Jurisdiction first, because the Tax module cannot answer this: it maps an
  // address to a configured rate and has no opinion about who is selling. Ask
  // it about a German address and it will happily hand back 19%, which is the
  // right rate for a German seller and the wrong one for an Indian exporter.
  const jurisdiction = classifyQuoteJurisdiction(
    input.origin_country_code,
    country
  )

  if (jurisdiction === "unknown_origin") {
    return {
      status: "unknown",
      total: null,
      inclusive: false,
      rates: [],
      reason: unknownOriginReason(country),
    }
  }

  if (jurisdiction === "export") {
    return {
      // A real zero, not a missing number — and `reason` still has to render,
      // because duty and import VAT land on the buyer and are not in it.
      status: "zero_rated_export",
      total: 0,
      inclusive: false,
      rates: [],
      reason: exportDisclosureReason(
        String(input.origin_country_code || ""),
        country,
        Boolean(input.duties_prepaid)
      ),
    }
  }

  try {
    const query: any = scope.resolve(ContainerRegistrationKeys.QUERY)

    // ---- The region decides the BASIS, not the rate ----------------------
    // `automatic_taxes` and `is_tax_inclusive` are per-region and
    // partner-settable, so they are read rather than assumed. A quote with no
    // region falls back to tax-exclusive, which is Medusa's own default and
    // the safer direction: it shows the tax as an addition rather than
    // quietly claiming it was already in the price.
    let isTaxInclusive = false
    if (input.region_id) {
      const { data: regions } = await query.graph({
        entity: "region",
        fields: ["id", "automatic_taxes", "is_tax_inclusive"],
        filters: { id: input.region_id },
      })
      const region = ((regions ?? []) as any[])[0]
      if (region && region.automatic_taxes === false) {
        // The cart will not tax this either. Saying "unknown" would be wrong —
        // this is a decision, not a gap.
        return {
          status: "not_applicable",
          total: null,
          inclusive: false,
          rates: [],
          reason: NOT_APPLICABLE_REASON,
        }
      }
      isTaxInclusive = Boolean(region?.is_tax_inclusive)
    }

    /**
     * The prices win when they have an opinion.
     *
     * The region flag above is a per-region SETTING; this is what the pricing
     * module actually returned for the rows this quote is built from. When the
     * two disagree the price is the fact and the setting is the guess — and on
     * prod they disagree on every quote.
     */
    if (input.prices_tax_inclusive !== null && input.prices_tax_inclusive !== undefined) {
      isTaxInclusive = Boolean(input.prices_tax_inclusive)
    }

    // ---- Ask the same module the cart will ------------------------------
    const taxService: any = scope.resolve(Modules.TAX)

    const goods = (input.lines || [])
      .filter((l) => Number.isFinite(Number(l.unit_amount)))
      .map((l) => ({
        id: l.variant_id,
        amount: Number(l.unit_amount) * Number(l.quantity),
        on: "goods" as const,
      }))

    const freightAmount = Number(input.freight?.amount ?? NaN)
    const hasFreight = Number.isFinite(freightAmount) && freightAmount > 0
    const FREIGHT_ID = "quote-freight"

    if (!goods.length && !hasFreight) return base

    const items = (input.lines || []).map((l) => ({
      id: l.variant_id,
      product_id: l.product_id ?? l.variant_id,
      // Only when known: an empty string here would be a product type that
      // matches nothing, which reads identically to "no rule matched" and is
      // the failure this field exists to end.
      ...(l.product_type_id ? { product_type_id: l.product_type_id } : {}),
      unit_price: Number(l.unit_amount),
      quantity: Number(l.quantity),
    }))
    const shipping = hasFreight
      ? [
          {
            id: FREIGHT_ID,
            // The freight leg is a `ShippingEstimateOption` amount, not a cart
            // shipping method, so there is no shipping-option row to point at
            // when the estimate came from a carrier rate. The tax module only
            // needs it to match option-scoped RULES; without one it falls
            // through to the region's default rate, which is the right answer
            // for an estimate.
            shipping_option_id: input.freight?.option_id ?? "",
            unit_price: freightAmount,
          },
        ]
      : []

    const taxLines: RawTaxLine[] = await taxService.getTaxLines(
      [...items, ...shipping],
      {
        address: {
          country_code: country,
          province_code: input.destination_province_code ?? null,
          postal_code: input.destination_postal_code ?? undefined,
        },
      }
    )

    if (!taxLines?.length) {
      // A configured region with a zero rate DOES return a line at rate 0, so
      // an empty answer means no region matched — a gap, not a zero.
      return { ...base, inclusive: isTaxInclusive }
    }

    const taxable = [
      ...goods,
      ...(hasFreight
        ? [{ id: FREIGHT_ID, amount: freightAmount, on: "freight" as const }]
        : []),
    ]

    const { total, rates } = foldTaxLines(taxable, taxLines, isTaxInclusive)

    return {
      status: "calculated",
      total,
      inclusive: isTaxInclusive,
      rates,
      reason: null,
    }
  } catch {
    // 🔑 Not silence. A tax block that vanishes reads as "no tax due", which is
    // a claim; the buyer is told the number is missing instead.
    return base
  }
}
