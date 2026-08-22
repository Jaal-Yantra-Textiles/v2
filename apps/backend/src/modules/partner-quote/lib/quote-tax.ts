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
   * - `not_applicable`: the region does not calculate tax automatically, so
   *   neither does the cart. Nothing is owed HERE, which is different from
   *   nothing being owed at all.
   * - `unknown`: no rate is configured for this destination. Say so.
   */
  status: "calculated" | "not_applicable" | "unknown"
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
  destination_country_code: string
  destination_postal_code?: string | null
  destination_province_code?: string | null
  lines: Array<{
    variant_id: string
    product_id?: string | null
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
