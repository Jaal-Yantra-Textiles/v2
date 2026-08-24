import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"

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
  }

  // Belt and braces: a return option created by hand — or by core's own return
  // flows — may carry the type without the rule.
  const typeCode = String(shippingOption?.type?.code || "").toLowerCase()
  if (typeCode === "return") return false

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
    ],
    filters: { id: input.store.default_location_id },
  })

  const manual: ShippingEstimateOption[] = []
  for (const fs of (optionLocations?.[0] as any)?.fulfillment_sets || []) {
    for (const zone of fs?.service_zones || []) {
      // 🔴 A zone that does not cover the destination must not price it.
      // Found live: a Mumbai domestic quote was given "European Shipping" at
      // 10 AUD, because every zone on the location was considered. A shipping
      // option is an offer to carry a parcel to the zone it belongs to; from
      // any other zone it is not a cheaper answer, it is a different question.
      if (!zoneCoversDestination(zone, countryCode)) continue

      for (const so of zone?.shipping_options || []) {
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
   * 🔴 #1424's currency guard, which only ever covered the MANUAL branch.
   *
   * Carriers quote in their OWN currency — an Indian carrier answers in INR
   * whatever the buyer is being billed in. `pickFreightOption` sorts on the raw
   * `amount` and `composeQuoteMoney` adds it straight to the subtotal, so an
   * INR rate on a EUR quote is not merely irrelevant: it silently WINS whenever
   * its number is smaller, and is then added to a EUR total and rendered with a
   * € sign.
   *
   * Seen on the first live international quote (Srinagar → Berlin, 3 kg, EUR):
   * Shiprocket answered ₹3,788 / ₹5,232.50 / ₹14,436 alongside a €35 flat.
   * €35 won ONLY because 35 is the smallest number — take the flat option away
   * and the buyer's landed total becomes €4,718 + 3,788 = €8,506.
   *
   * Dropped rather than converted: converting needs an FX rate this function
   * does not have, and a wrong rate is a wrong price wearing a confident label.
   * Cross-border live rates in the buyer's own currency are a real gap, but a
   * gap is recoverable and a mispriced consignment is not.
   */
  const calculated = rawCalculated.filter((r) => {
    if (!quoteCurrency) return true
    if (r.currency_code === quoteCurrency) return true
    logger?.warn?.(
      `[shipping-estimate] dropped ${carrier} rate ${r.amount} ${r.currency_code} — quote is in ${quoteCurrency}, and mixing currencies would corrupt the landed total`
    )
    return false
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
    cache_hit: cacheHit,
    // Never present these as a final price: carrier rates move, and the manual
    // tier is a placeholder the partner is expected to edit.
    is_estimate: true,
  }
}
