import { ContainerRegistrationKeys, MedusaError, QueryContext } from "@medusajs/framework/utils"

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
  quoted_at?: Date | string | null
  recipient_name?: string | null
  recipient_company?: string | null
  partner_note?: string | null
  lines?: QuoteViewLineRow[] | null
}

/** One line as the buyer is currently looking at it. */
export type BuildQuoteViewLine = {
  variant_id: string
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
  carrier?: string
  /** Passed in so the whole view is deterministic under test. */
  now: Date
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
  }
  compare: QuoteCompareResult
  recipient: {
    name: string | null
    company: string | null
    partner_note: string | null
  }
  expires_in_days: number | null
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
 * PURE: basket totals from priced lines and the one freight leg.
 *
 * `unit_amount` on a basket total is only meaningful for a single-line quote;
 * for a real basket it is the blended per-unit figure, which is why the lines
 * carry their own and this is only ever the summary row.
 */
export function composeQuoteMoney(
  lineSubtotals: number[],
  totalUnits: number,
  freight: number
): QuoteMoney {
  const subtotal = lineSubtotals.reduce((sum, n) => sum + n, 0)
  return {
    unit_amount: totalUnits > 0 ? subtotal / totalUnits : 0,
    subtotal,
    freight,
    landed_total: subtotal + freight,
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
  return {
    unit_amount: totalUnits > 0 ? subtotal / totalUnits : 0,
    subtotal,
    freight: Number(quote.quoted_freight ?? 0),
    landed_total: Number(quote.quoted_landed_total),
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
    fields: ["id", "title", "product.id", "product.title", "product.handle"],
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

  let live: QuoteMoney | null = null
  let liveError: string | null = null
  let totalWeightGrams: number | null = null
  let chosen: ShippingEstimateOption | null = null
  let options: ShippingEstimateOption[] = []
  let freightError: string | null = null
  let liveUnitByVariant = new Map<string, number>()
  let weightByVariant = new Map<
    string,
    { unit_weight_grams: number; weight_source: "variant" | "product" }
  >()

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
        carrier: input.carrier,
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

      if (!chosen) {
        // A landed total with no freight in it is a wrong number wearing a
        // confident label. Better to have no live half at all.
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          freightError
            ? `No freight option could be quoted for this lane: ${freightError}`
            : "No freight option could be quoted for this lane."
        )
      }

      live = composeQuoteMoney(
        effectiveLines.map(
          (l) => (liveUnitByVariant.get(l.variant_id) ?? 0) * l.quantity
        ),
        effectiveLines.reduce((sum, l) => sum + l.quantity, 0),
        Number(chosen.amount)
      )
    } catch (err) {
      // The quoted half — what the partner actually told this buyer — is still
      // worth showing when the live half cannot be built.
      liveError = err instanceof Error ? err.message : String(err)
      live = null
    }
  }

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
      quantity: line.quantity,
      position: line.position ?? frozen?.position ?? index,
      note: line.note ?? frozen?.note ?? null,
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
    freight: { chosen, options, error: freightError },
    compare,
    recipient: {
      name: input.quote?.recipient_name ?? null,
      company: input.quote?.recipient_company ?? null,
      partner_note: input.quote?.partner_note ?? null,
    },
    expires_in_days: input.quote ? daysUntilExpiry(lifecycle, input.now) : null,
    live_error: liveError,
  }
}
