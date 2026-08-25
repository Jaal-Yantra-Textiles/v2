import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"

import { planShippingFxConversion } from "../modules/partner_billing/shipping-ledger"
import { isInternationalDestination } from "../modules/shipping-providers/destination"
import {
  rateWithOriginFallback,
  resolveCoreExportOrigins,
  type ExportOrigin,
} from "../modules/shipping-providers/export-origins"
import { resolveShippingProvider } from "../modules/shipping-providers/resolver"

/**
 * The freight estimate, as a function rather than an HTTP route (#1389 S2).
 *
 * ## Why this was extracted
 *
 * `GET /store/shipping-estimate` owned this logic inline. The B2B quote builder
 * needs the same number, and the only ways to reuse a route body are to copy it
 * or to HTTP to yourself. Copying gives you two freight paths that will disagree
 * — the exact failure the quote model exists to prevent — and HTTP-to-self
 * throws away the 15-minute cache from the caller's perspective, buys a second
 * round-trip, and turns a carrier hiccup into a self-inflicted 500.
 *
 * So the route and the quote builder both call this. One cache, one weight
 * rule, one shape.
 *
 * ## A basket, not a line
 *
 * The input is a LIST of lines, because a multi-product quote ships as ONE
 * consignment: the lane is quoted once, against the summed weight. Quoting
 * each line separately and adding the results charges the buyer for several
 * deliveries they are not getting, and at bulk quantities that error is not
 * small. `GET /store/shipping-estimate` is simply the one-line case.
 *
 * ## Weight: fall back to the product, never to a guess
 *
 * A variant with no weight of its own inherits the PRODUCT's, and the estimate
 * says which one it used (#1394 item 2). That rescues 21 variants platform-wide
 * that are unquotable otherwise.
 *
 * 🔑 The fallback is reported, not buried. A declared product weight over-quotes
 * a lighter variant — 115 g against a real 105 g — and at 200 units that can
 * cross a carrier slab, so `weight_source` travels with the number and gets
 * frozen onto the quote row.
 *
 * When NEITHER level has a weight, this refuses with a 422 naming the variant.
 * That is deliberate and it is the one place this differs from the order-83
 * fulfilment path, which estimates a weight when none exists. Estimating is fine
 * for an internal retry; it is not fine for a number a buyer decides on. 140 of
 * 183 variants platform-wide have no weight at either level, so this refusal
 * fires for real — the gap belongs in the catalogue, not papered over here.
 */

export type ShippingEstimateLineInput = {
  variant_id: string
  quantity: number
}

export type ShippingEstimateInput = {
  /** The basket. One entry is the ordinary single-product case. */
  lines: ShippingEstimateLineInput[]
  destination_postal_code: string
  country_code?: string
  /**
   * The currency the quote is denominated in. REQUIRED to compare manual
   * options: the picker sorts on the raw `amount`, so without this an option
   * priced in another currency silently wins whenever its number is smaller.
   */
  currency_code?: string
  carrier?: string
  /**
   * Override the HQ export origins (#1498). Omit in production — they are
   * derived from `location_ownership.is_core`, the warehouses already recorded
   * as ours, so a new hub becomes an origin the moment it is marked.
   */
  export_fallback_origins?: ExportOrigin[]

  /** The store whose default stock location is the origin. */
  store: { id?: string; default_location_id?: string | null }
}

export type ShippingEstimateOption = {
  shipping_option_id?: string
  courier_id?: string | null
  courier_name?: string | null
  name?: string
  amount: number
  currency_code: string
  estimated_days?: number | null
  is_recommended?: boolean
  source: "manual" | "calculated"
  /**
   * Set when this amount was CONVERTED from the carrier's own currency (#1498).
   *
   * 🔑 The rate travels with the number rather than being logged. A converted
   * price that records only its result cannot be reproduced once FX has moved,
   * so nobody can later check whether a quote was priced honestly — which is
   * the whole objection that kept these rates being dropped instead.
   */
  fx?: {
    original_amount: number
    original_currency_code: string
    fx_rate: number
    fx_source: "operator" | "fx_rates"
    converted_at: string
  }
  /**
   * How this number was actually routed (#1498). Present only on a relay —
   * absent means the partner's own pin exported it directly.
   *
   * 🔑 It travels with the amount rather than being logged, because a landed
   * price that is silently two legs is unauditable: nobody can later say why a
   * Srinagar quote carries a Delhi courier or where the extra ₹206 came from,
   * and the margin cannot be checked.
   */
  route?: {
    via_hq: boolean
    origin_pincode: string
    origin_label: string | null
    export_leg_amount: number
    domestic_leg_amount: number | null
    /** The relay is real but its first leg has no price — an under-quote. */
    domestic_leg_unrated: boolean
  }
}

export type ShippingEstimateLine = {
  variant_id: string
  variant_title: string | null
  product_id: string | null
  product_title: string | null
  quantity: number
  unit_weight_grams: number
  /** Which level the unit weight came from. See the header. */
  weight_source: "variant" | "product"
  line_weight_grams: number
}

export type ShippingEstimate = {
  lines: ShippingEstimateLine[]
  /** The whole consignment. This is what the carrier was asked about. */
  total_weight_grams: number
  origin_postal_code: string
  destination_postal_code: string
  country_code: string
  manual: ShippingEstimateOption[]
  calculated: ShippingEstimateOption[]
  calculated_error: string | null
  /**
   * Was a carrier actually asked to rate this lane? (#1528)
   *
   * 🔴 An empty `calculated` list means two completely different things, and
   * the estimate was the only place that could still tell them apart:
   *
   * - `carrier === "manual" | "none"` — a deliberate decision to ask NOBODY.
   *   The store's flat tiers ARE the whole answer, and there is nothing to
   *   report.
   * - a carrier that was asked and returned nothing — no rates, and no error
   *   either. `calculated_error` stays null, so downstream the two are
   *   indistinguishable, and readiness read the silence as "the carrier rated
   *   the lane and the flat tier won".
   *
   * It did not. On 25 Aug a real Amsterdam quote (1080 g, EUR) went out on a
   * flat €35 at `ready: true`, hours after the same lane returned seven
   * carrier options with the cheapest at €36.42. The guard written to stop a
   * flat tier standing in for an unknown rate was blind to the case where the
   * carrier says nothing at all.
   *
   * So the fact is recorded here rather than re-derived. See
   * `needsManualFreightRate`.
   */
  carrier_consulted: boolean
  /**
   * A shipping option on a zone covering the destination, whatever its price
   * type. Acceptance borrows its service zone and shipping profile when the
   * freight came from a live carrier rate, which is not a Medusa option and so
   * carries no id of its own. Null means the store has no configured lane to
   * this country at all — the honest reason a quote cannot be accepted.
   */
  lane_option_id: string | null
  cache_hit: boolean
  is_estimate: true
}

/**
 * PURE: pick the unit weight and say where it came from.
 *
 * Split out so the rule that decides a buyer's freight number is testable
 * without a container, a carrier or a database.
 */
export function resolveUnitWeight(variant: {
  id?: string
  title?: string | null
  weight?: unknown
  product?: { weight?: unknown } | null
}): { weight_grams: number; weight_source: "variant" | "product" } | null {
  const variantWeight = Number(variant?.weight)
  if (variantWeight && !Number.isNaN(variantWeight) && variantWeight > 0) {
    return { weight_grams: variantWeight, weight_source: "variant" }
  }

  const productWeight = Number(variant?.product?.weight)
  if (productWeight && !Number.isNaN(productWeight) && productWeight > 0) {
    return { weight_grams: productWeight, weight_source: "product" }
  }

  return null
}

/**
 * PURE: may this shipping option be OFFERED as outbound freight?
 *
 * 🔴 The fourth blindness on this picker, and the same shape as the other
 * three: it sorts on the raw amount, so any row that does not belong on the
 * lane wins by being small.
 *
 * `create-store-with-defaults` gives every store a **"Return Shipping"** option
 * — flat, untiered, and deliberately cheap (₹100 against a ₹200 base) — carrying
 * an option-level rule `is_return = true`. The estimate read PRICE rules (#1430)
 * and never option rules, so the return row was pushed as an ordinary offer and
 * became the cheapest option on every domestic Indian lane. Quotes were being
 * freighted at the return-pickup rate.
 *
 * `enabled_in_store: "false"` is refused for the same reason a revoked quote is
 * not re-priced: an option the store has switched off is not an offer we may
 * make on its behalf. An option with no rules at all is allowed — absence is
 * not a prohibition, and most hand-made options carry none.
 *
 * ## 🔴 A `quote_id` rule means the option belongs to ONE buyer (#1527)
 *
 * Accepting a quote mints a flat option priced at that quote's frozen freight,
 * carrying `quote_id eq <id>` so it is invisible to every other CART. That
 * hiding is done by core's rule engine, via
 * `hooks/quote-shipping-options-context.ts` — and this estimate never goes
 * through core's rule engine. It reads the zone's options straight out of
 * `query.graph`, so every per-quote option ever minted stood as an ordinary
 * candidate here, for unrelated quotes, priced at whatever one buyer once
 * negotiated.
 *
 * Live on prod 25 Aug: a `99 INR` row from a revoked test quote. The picker
 * sorts on the raw amount, so it would have won **any** INR quote by being the
 * smallest number — regardless of weight, lane or destination. The fourth time
 * this exact shape has shipped (#1424 zone-blind, #1430 rule-blind, #1485 the
 * return option): a row nobody chose for *this* shipment winning it by being
 * small.
 *
 * 🔑 The refusal lives HERE, in the callee, and not only in the teardown that
 * deletes the option on revoke (`revokeQuote`). Teardown alone would leave a
 * *live* quote's negotiated freight standing as a candidate for the next
 * buyer, and would depend on every future path that kills a quote remembering
 * to clean up. One buyer's freight is never an offer to another, dead or
 * alive.
 */
export function isQuotableShippingOption(shippingOption: any): boolean {
  const rules = (shippingOption?.rules ?? []) as Array<{
    attribute?: string
    value?: unknown
    operator?: string
  }>

  for (const rule of rules) {
    const attribute = String(rule?.attribute || "").trim()
    const value = String(rule?.value ?? "").trim().toLowerCase()

    if (attribute === "is_return" && value === "true") return false
    if (attribute === "enabled_in_store" && value === "false") return false
    // 🔴 Scoped to one quote's cart — see the header. Not ours to offer.
    if (attribute === "quote_id") return false
  }

  // Belt and braces: a return option created by hand — or by core's own return
  // flows — may carry the type without the rule. Likewise a per-quote option,
  // whose type code acceptance sets deliberately (`quoted-freight`).
  //
  // ⚠️ This read was DEAD until #1527: the estimate's own query never asked for
  // `shipping_options.type`, so `type` arrived undefined on every option and
  // both belts checked a field that was always absent. Absence in the
  // instrument, not in the world — the same reading error as #1528. The field
  // is fetched now.
  const typeCode = String(shippingOption?.type?.code || "").toLowerCase()
  if (typeCode === "return" || typeCode === "quoted-freight") return false

  return true
}

/**
 * PURE: does this service zone actually cover the destination country?
 *
 * A shipping option is an offer to carry a parcel to the zone it belongs to.
 * Considering every zone on the location turns a European flat rate into a
 * candidate for a Mumbai delivery — found live, where a 21 kg domestic
 * consignment was quoted "European Shipping" at 10 AUD.
 *
 * A zone with NO geo zones is treated as covering nothing rather than
 * everything: an unscoped zone is a provisioning accident, and reading it as
 * "worldwide" is how one bad row prices every lane.
 */
export function zoneCoversDestination(
  zone: { geo_zones?: Array<{ country_code?: string | null }> | null } | null,
  destinationCountry: string
): boolean {
  const target = String(destinationCountry || "").toLowerCase()
  if (!target) return false

  const zones = zone?.geo_zones ?? []
  return zones.some(
    (g) => String(g?.country_code || "").toLowerCase() === target
  )
}

/**
 * PURE (given a rate lookup): put every CALCULATED rate into the quote's
 * currency, or drop the ones that cannot get there (#1498).
 *
 * Split out of `buildShippingEstimate` because this is the rule that decides a
 * buyer's freight number, and a rule that can only be exercised through a
 * container, a cache and a live carrier is a rule nothing checks.
 *
 * The `lookup` is injected for the same reason `resolveShippingFx` resolves the
 * rate at the container edge: under module isolation the arithmetic and the
 * rate cannot live in the same place, so the rate arrives as a finished fact.
 */
export async function convertCalculatedRates(args: {
  rates: ShippingEstimateOption[]
  /** The quote's currency, lower-case. Empty means "no target" — pass through. */
  quoteCurrency: string
  /** from-currency → rate, or null when no path exists. Called once per currency. */
  lookup: (fromCurrency: string) => Promise<number | null>
  convertedAt: string
  logger?: { warn?: (m: string) => void }
  /** Only for the log line. */
  carrier?: string
}): Promise<ShippingEstimateOption[]> {
  const { rates, quoteCurrency, lookup, convertedAt, logger } = args
  const out: ShippingEstimateOption[] = []
  const cache = new Map<string, number | null>()

  for (const r of rates ?? []) {
    // No target currency means nothing to convert TO. Pass through rather than
    // invent one — this is the `/store/shipping-estimate` single-currency case.
    if (!quoteCurrency || r.currency_code === quoteCurrency) {
      out.push(r)
      continue
    }

    if (!cache.has(r.currency_code)) {
      cache.set(r.currency_code, await lookup(r.currency_code))
    }

    const planned = planShippingFxConversion({
      amount: r.amount,
      currency_code: r.currency_code,
      orderCurrency: quoteCurrency,
      rate: cache.get(r.currency_code) ?? null,
      source: "fx_rates",
      convertedAt,
    })

    // 🔴 Still dropped when there is no rate. A cold FX cache must not become a
    // guess: that is the one thing the original #1424 drop got right.
    if (!planned) {
      logger?.warn?.(
        `[shipping-estimate] dropped ${args.carrier ?? "carrier"} rate ${r.amount} ` +
          `${r.currency_code} — no rate to ${quoteCurrency}, and mixing currencies ` +
          `would corrupt the landed total`
      )
      continue
    }

    out.push({
      ...r,
      amount: planned.amount,
      currency_code: planned.currency_code.toLowerCase(),
      fx: {
        original_amount: planned.fx.original_amount,
        original_currency_code: planned.fx.original_currency_code.toLowerCase(),
        fx_rate: planned.fx.fx_rate,
        fx_source: planned.fx.fx_source,
        converted_at: planned.fx.converted_at,
      },
    })
  }

  return out
}

/**
 * Bucket the weight so near-identical quantities share a cache entry rather
 * than minting one per quantity a buyer drags a slider through.
 */
export function weightBucketGrams(weightGrams: number): number {
  return Math.ceil(weightGrams / 500) * 500
}

export async function buildShippingEstimate(
  scope: any,
  input: ShippingEstimateInput
): Promise<ShippingEstimate> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)

  const countryCode = String(input.country_code || "in").toLowerCase()
  const quoteCurrency = String(input.currency_code || "").toLowerCase()
  const destinationPostalCode = String(input.destination_postal_code)

  const lineInputs = (input.lines || []).filter(
    (l) => l && l.variant_id && Number(l.quantity) > 0
  )
  if (!lineInputs.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "A freight estimate needs at least one line with a quantity."
    )
  }

  // ---- Weights -----------------------------------------------------------
  const { data: variants } = await query.graph({
    entity: "variant",
    fields: [
      "id",
      "title",
      "weight",
      "product.id",
      "product.title",
      "product.weight",
    ],
    filters: { id: lineInputs.map((l) => l.variant_id) },
  })
  const byId = new Map<string, any>(
    ((variants ?? []) as any[]).map((v) => [v.id, v])
  )

  const lines: ShippingEstimateLine[] = []
  for (const line of lineInputs) {
    const variant = byId.get(line.variant_id)
    if (!variant) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Variant ${line.variant_id} not found`
      )
    }

    const resolved = resolveUnitWeight(variant)
    if (!resolved) {
      // Deliberately a refusal, not a fallback, and it fails the WHOLE basket:
      // a landed total missing one line's freight is a wrong number wearing a
      // confident label. See the header.
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Variant "${variant.title || variant.id}" has no shipping weight, and neither does its product, so freight cannot be quoted for it. Set a weight on the variant first.`
      )
    }

    const quantity = Number(line.quantity)
    lines.push({
      variant_id: variant.id,
      variant_title: variant.title ?? null,
      product_id: variant.product?.id ?? null,
      product_title: variant.product?.title ?? null,
      quantity,
      unit_weight_grams: resolved.weight_grams,
      weight_source: resolved.weight_source,
      line_weight_grams: Math.round(resolved.weight_grams * quantity),
    })
  }

  const totalWeightGrams = lines.reduce((sum, l) => sum + l.line_weight_grams, 0)

  // ---- Origin ------------------------------------------------------------
  // 🔴 REFUSE rather than read everything. `filters: { id: undefined }` is not
  // "no location", it is NO FILTER — every stock location on the platform, from
  // every tenant. That is how one dangling publishable key took every
  // storefront down (#1397), and it is how the public quote page ended up
  // offering a buyer another partner's "In Person Pickup" while omitting the
  // store's own domestic option.
  //
  // A missing origin cannot produce a right answer, so it must not produce a
  // confident wrong one. The caller is the only thing that knows which store
  // this is; if it did not say, that is the bug, and it should be loud.
  if (!input.store?.default_location_id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "No pickup location was given for this store, so freight cannot be quoted. (Refusing to read every location on the platform.)"
    )
  }

  const { data: locations } = await query.graph({
    entity: "stock_locations",
    fields: ["id", "name", "address.postal_code", "address.country_code"],
    filters: { id: input.store.default_location_id },
  })
  const originPostalCode = String(
    (locations?.[0] as any)?.address?.postal_code || ""
  ).trim()
  if (!originPostalCode) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "This store's pickup location has no postal code, so freight cannot be quoted. Add one to the location."
    )
  }

  // ---- Manual / flat options — no carrier call ---------------------------
  const { data: optionLocations } = await query.graph({
    entity: "stock_locations",
    fields: [
      "id",
      "fulfillment_sets.service_zones.geo_zones.country_code",
      "fulfillment_sets.service_zones.shipping_options.id",
      "fulfillment_sets.service_zones.shipping_options.name",
      "fulfillment_sets.service_zones.shipping_options.price_type",
      "fulfillment_sets.service_zones.shipping_options.prices.*",
      // Needed to SKIP conditional prices — see the rule check below. Without
      // this relation the rows arrive looking unconditional.
      "fulfillment_sets.service_zones.shipping_options.prices.price_rules.*",
      // OPTION-level rules, which are a different thing from price rules and
      // were never read. See `isQuotableShippingOption`.
      "fulfillment_sets.service_zones.shipping_options.rules.*",
      // The type code is the second half of `isQuotableShippingOption`'s belt
      // and braces, and went unfetched until #1527 — so it checked a field
      // that could never arrive. Proven path: `/partners/stores/:id/shipping-options`.
      "fulfillment_sets.service_zones.shipping_options.type.*",
    ],
    filters: { id: input.store.default_location_id },
  })

  const manual: ShippingEstimateOption[] = []
  /**
   * An option id on a zone that covers the destination — the LANE, independent
   * of any price (#1498, widened here).
   *
   * 🔴 Acceptance needs a `shipping_option_id` to borrow a service zone and
   * shipping profile from; a carrier rate is not a Medusa option and carries
   * none. That donor used to be found among the MANUAL options, which quietly
   * made a manually-PRICED option a precondition for a quote being acceptable
   * at all. Remove the flat tiers — which is the whole point of moving to live
   * rates — and every new quote becomes un-acceptable at the last step, the
   * #1497 failure again and again discovered by the buyer.
   *
   * The zone is a property of the LANE, not of a price. So it is recorded while
   * walking the zones, from any quotable option, priced or not. A manual option
   * still wins the donor slot when one exists, purely for continuity with every
   * quote already minted.
   */
  let laneOptionId: string | null = null
  let manualLaneOptionId: string | null = null
  for (const fs of (optionLocations?.[0] as any)?.fulfillment_sets || []) {
    for (const zone of fs?.service_zones || []) {
      // 🔴 A zone that does not cover the destination must not price it.
      // Found live: a Mumbai domestic quote was given "European Shipping" at
      // 10 AUD, because every zone on the location was considered. A shipping
      // option is an offer to carry a parcel to the zone it belongs to; from
      // any other zone it is not a cheaper answer, it is a different question.
      if (!zoneCoversDestination(zone, countryCode)) continue

      for (const so of zone?.shipping_options || []) {
        // 🔴 The lane donor is recorded BEFORE the calculated skip, because a
        // store moving to live rates may have nothing but calculated options —
        // and it still has a lane. `isQuotableShippingOption` still gates it:
        // a return row or another quote's freight is not this lane's donor.
        if (isQuotableShippingOption(so) && so?.id) {
          if (!laneOptionId) laneOptionId = String(so.id)
          if (so.price_type !== "calculated" && !manualLaneOptionId) {
            manualLaneOptionId = String(so.id)
          }
        }

        if (so?.price_type === "calculated") continue
        // 🔴 A RETURN option is not an outbound offer. See below.
        if (!isQuotableShippingOption(so)) continue
        for (const price of so?.prices || []) {
          // Only currency-scoped flat prices are meaningful without a cart;
          // region-scoped ones need a region the estimate does not have.
          if (!price?.currency_code) continue

          // 🔴 And it must be priced in the currency we are quoting. The picker
          // sorts on the raw `amount`, so an option in another currency is not
          // merely irrelevant — it silently WINS whenever its number happens to
          // be smaller. 10 AUD beat 200 INR and was then rendered as Rs 10.
          if (
            quoteCurrency &&
            String(price.currency_code).toLowerCase() !== quoteCurrency
          ) {
            continue
          }

          // 🔴 A RULE-BOUND price is not an offer this estimate can make.
          //
          // `create-store-with-defaults` gives every Indian store a second
          // price row of 0 INR gated on `item_total >= 2999` — retail free
          // shipping. Pushed unconditionally, that 0 is the cheapest option on
          // the lane and the picker takes it, so EVERY quote from such a store
          // was quoting freight 0. Found live: the first prod B2B quote
          // (₹36,00,000, 21 kg to Mumbai) froze `quoted_freight: 0`.
          //
          // The estimate has no cart, so it cannot evaluate `item_total` — and
          // it must not guess. Same reasoning as the currency check above and
          // the region one below it: a price whose applicability we cannot
          // establish is not a cheaper answer, it is a different question.
          // This is the THIRD blindness on this picker — zone (#1424),
          // currency (#1424), and now rule.
          if ((price?.price_rules?.length ?? 0) > 0) continue

          manual.push({
            shipping_option_id: so.id,
            name: so.name,
            amount: Number(price.amount),
            currency_code: String(price.currency_code).toLowerCase(),
            source: "manual",
          })
        }
      }
    }
  }

  // ---- Calculated rates — cached per lane --------------------------------
  const carrier = String(input.carrier || "shiprocket").toLowerCase()

  /**
   * "manual" is an explicit choice to ask NO carrier (#1447).
   *
   * 🔑 Distinct from a carrier that fails: a failure logs, sets
   * `calculated_error` and warrants an "indicative rate" notice on the buyer's
   * page. This is someone deciding the lane is priced by hand, so there is
   * nothing to report and nothing to retry — the manual tiers gathered above
   * are the whole answer.
   */
  if (carrier === "manual" || carrier === "none") {
    return {
      lines,
      total_weight_grams: totalWeightGrams,
      origin_postal_code: originPostalCode,
      destination_postal_code: destinationPostalCode,
      country_code: countryCode,
      manual,
      calculated: [],
      calculated_error: null,
      // Nobody was asked, on purpose. This is what stops the empty list above
      // being read as a carrier that failed silently (#1528).
      carrier_consulted: false,
      lane_option_id: manualLaneOptionId ?? laneOptionId,
      cache_hit: false,
      is_estimate: true,
    }
  }

  const weightBucket = weightBucketGrams(totalWeightGrams)

  /**
   * 🔑 The origin is no longer necessarily the partner's pin (#1498).
   *
   * A partner in Srinagar cannot export: 190001 → NL is a 400, *no serviceable
   * couriers*, so the lane dropped to the flat fallback — which is one number
   * whatever the parcel weighs. That is the whole reason international freight
   * read flat at any weight. Delhi HQ rates the same parcel at ₹1,276 across 8
   * couriers, and the goods route through a warehouse anyway.
   *
   * The loop lives ABOVE the provider on purpose: "retry from an HQ origin" is
   * a fact about how we move goods, not about Shiprocket, and Blue Dart / DTDC
   * / DHL slot into the same call as each gains a rate API. See
   * `shipping-providers/export-origins.ts` for the two traps it is built around.
   *
   * Exports only, and only as a FALLBACK: if the partner's own pin rates, that
   * is the answer and no hub is asked. Relaying a Srinagar → Mumbai parcel
   * through Delhi is not something we do either.
   *
   * The hubs come from `location_ownership.is_core` — the warehouses already
   * recorded as ours — not from configuration, so this is live the moment a
   * warehouse is marked rather than when an env var is remembered.
   */
  const hqOrigins = isInternationalDestination(countryCode)
    ? (input.export_fallback_origins ?? (await resolveCoreExportOrigins(scope)))
    : []

  let rawCalculated: ShippingEstimateOption[] = []
  let calculatedError: string | null = null
  let cacheHit = false

  const cacheService: any = scope.resolve(Modules.CACHE)

  /**
   * One carrier call per LEG, cached per leg.
   *
   * 🔑 Per-leg rather than per-quote: `110032 → NL at 1.2 kg` is the same
   * question for every partner on the platform, so the second partner to quote
   * that lane pays nothing for it. A cache keyed on the whole route would miss
   * every time the first leg differed.
   *
   * 🔑 Held UNFILTERED by currency — the carrier answers in its own, and the
   * guard is applied on both the hit and the miss path. Caching the filtered
   * list under a key with no currency in it would serve an INR quote's
   * survivors to a EUR one, which is the bug the guard exists to prevent,
   * reintroduced through the cache.
   */
  const rateLeg = async (q: {
    origin_pincode: string
    destination_pincode: string
    destination_country?: string
    weight_grams: number
  }): Promise<any[]> => {
    const legKey =
      `shipping-estimate:${carrier}:${q.origin_pincode}:` +
      `${q.destination_pincode}:${q.destination_country || ""}:${q.weight_grams}`
    const hit = await cacheService.get(legKey).catch(() => null)
    if (hit) {
      cacheHit = true
      return hit as any[]
    }
    const provider = await resolveShippingProvider(scope, carrier)
    if (!provider.getRates) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `${carrier} does not support rate quotes`
      )
    }
    const rates = (await provider.getRates(q)) || []
    await cacheService.set(legKey, rates, 900).catch(() => {})
    return rates
  }

  try {
    const routes = await rateWithOriginFallback({
      partnerOrigin: originPostalCode,
      hqOrigins,
      destinationPincode: destinationPostalCode,
      destinationCountry: countryCode,
      weightGrams: weightBucket,
      rate: rateLeg,
      // Filtered downstream against the quote currency, so the fallback keeps
      // every currency and lets the existing guard do the dropping and the
      // logging in one place.
      currencyCode: null,
      chargeDomesticLeg: process.env.EXPORT_FIRST_LEG_IS_SUNK !== "true",
      logger,
    })

    if (!routes.length && hqOrigins.length) {
      // Distinguishable in the log from "we never tried": an operator needs to
      // know the relay was attempted and refused, not that it is unconfigured.
      logger?.warn?.(
        `[shipping-estimate] no origin could rate ${originPostalCode} -> ` +
          `${countryCode}, including ${hqOrigins.length} HQ pin(s).`
      )
    }

    rawCalculated = routes.map((r) => ({
      courier_id: r.courier_id,
      courier_name: r.courier_name,
      amount: r.total_amount,
      currency_code: r.currency_code,
      estimated_days: r.estimated_days,
      is_recommended: r.is_recommended,
      source: "calculated" as const,
      // 🔑 The route travels WITH the number. A landed price that is silently
      // two legs is unauditable: nobody can later say why a Srinagar quote
      // carries a Delhi courier, or where the extra ₹206 came from.
      route:
        r.via_hq || r.domestic_leg
          ? {
              via_hq: r.via_hq,
              origin_pincode: r.origin_pincode,
              origin_label: r.origin_label,
              export_leg_amount: r.export_leg.amount,
              domestic_leg_amount: r.domestic_leg?.amount ?? null,
              domestic_leg_unrated: r.domestic_leg_unrated,
            }
          : undefined,
    }))
  } catch (err) {
    // A carrier that will not quote must not blank the whole estimate — the
    // manual options are still a real, quotable answer.
    calculatedError = err instanceof Error ? err.message : String(err)
    logger?.warn?.(
      `[shipping-estimate] ${carrier} rates failed for ${originPostalCode}->${destinationPostalCode}: ${calculatedError}`
    )
  }

  /**
   * 🔴 #1424's currency guard — now a CONVERSION, not a drop (#1498).
   *
   * ## What the guard was right about
   *
   * Carriers quote in their OWN currency: an Indian carrier answers in INR
   * whatever the buyer is being billed in. `pickFreightOption` sorts on the raw
   * `amount` and `composeQuoteMoney` adds it straight to the subtotal, so an
   * INR rate on a EUR quote is not merely irrelevant — it silently WINS
   * whenever its number is smaller, and is then added to a EUR total and
   * rendered with a € sign. Seen live: Srinagar → Berlin answered ₹3,788 /
   * ₹5,232 / ₹14,436 alongside a €35 flat, and €35 "won" only because 35 is the
   * smallest number.
   *
   * ## Why dropping them was not the end of it
   *
   * The guard shipped as a drop, on the reasoning that converting needs an FX
   * rate this function does not have and a wrong rate is a wrong price wearing
   * a confident label. That was right about the danger and wrong about the
   * remedy, and #1498 made the cost obvious:
   *
   * Every carrier rate for an export lane is in INR, so on a EUR quote the
   * calculated list is ALWAYS empty and the flat manual row wins by WALKOVER —
   * not by being cheaper, but by being the only survivor. That row is €35 at
   * 3 kg and €35 at 22 kg. The measured cost of the same 3 kg lane is ₹4,057
   * landed (≈ €43), and it rises with weight while €35 never moves. So the
   * drop was quietly guaranteeing the "international freight is flat at any
   * weight" defect it looked unrelated to.
   *
   * ## The rate comes from outside, and travels with the number
   *
   * Same shape as `resolveShippingFx` already uses for order freight, and the
   * same pure `planShippingFxConversion` does the arithmetic and the
   * minor-unit rounding — one FX path, not a second one to disagree with it.
   * The rate, its source and the original amount are recorded on the option, so
   * a converted price can be reproduced after FX has moved. That is what
   * removes the "confident label" problem: the label now shows its working.
   *
   * 🔑 A rate that CANNOT be converted is still dropped, exactly as before. A
   * cold FX cache must not become a guess.
   *
   * ⚠️ CALCULATED rates only. A manual option priced in another currency is a
   * different offer the partner made to buyers billed in that currency;
   * converting it would invent an offer nobody published. Those are filtered
   * out further up, on the currency check beside the zone and rule checks.
   */
  const calculated = await convertCalculatedRates({
    rates: rawCalculated,
    quoteCurrency,
    convertedAt: new Date().toISOString(),
    carrier,
    logger,
    lookup: async (from) => {
      try {
        const fx: any = scope.resolve("fx_rates")
        const r = Number(await fx.getRate(from, quoteCurrency))
        return Number.isFinite(r) && r > 0 ? r : null
      } catch (e: any) {
        // `getRate` throws NOT_FOUND when the cache has no path between the two
        // currencies — a cold cache, or one the provider does not quote.
        logger?.warn?.(
          `[shipping-estimate] no ${from}->${quoteCurrency} rate (${e?.message}); ` +
            `carrier rates in ${from} will be dropped rather than guessed.`
        )
        return null
      }
    },
  })

  return {
    lines,
    total_weight_grams: totalWeightGrams,
    origin_postal_code: originPostalCode,
    destination_postal_code: destinationPostalCode,
    country_code: countryCode,
    manual,
    calculated,
    calculated_error: calculatedError,
    // A carrier WAS asked on this path, whatever it answered — including
    // nothing at all, which is the case #1528 was blind to.
    carrier_consulted: true,
    lane_option_id: manualLaneOptionId ?? laneOptionId,
    cache_hit: cacheHit,
    // Never present these as a final price: carrier rates move, and the manual
    // tier is a placeholder the partner is expected to edit.
    is_estimate: true,
  }
}
