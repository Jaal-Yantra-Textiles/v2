/**
 * Rate an export from an HQ pin when the partner's own cannot be rated (#1498).
 *
 * ## The fact this encodes
 *
 * A partner in Srinagar cannot export directly. Probed live against Shiprocket
 * on 2026-08-24, 1.2 kg / 30×25×10:
 *
 * | origin | → NL | → DE |
 * |---|---|---|
 * | 190001 Srinagar (partner) | ❌ 400, *no serviceable couriers* | ❌ 400 |
 * | 110032 Delhi HQ | ✅ 8 couriers, from ₹1,276 | ✅ 5, from ₹1,852 |
 * | 176215 Himachal HQ | ✅ 1 courier, ₹2,916 | ✅ 2, from ₹1,852 |
 *
 * The goods already route through a warehouse and export from there — this
 * makes the *quote* describe the movement that actually happens. It is also the
 * root cause of international freight reading flat at any weight: the partner
 * pin 400s and every lane drops to `flatFallback`, which is one number
 * regardless of weight.
 *
 * ## 🔴 Trap 1 — HQ pins are NOT interchangeable
 *
 * Delhi returns 8 couriers at ₹1,276 to NL; Himachal returns one at ₹2,916 —
 * **2.3×** for the same parcel. A single hardcoded fallback silently
 * over-quotes, so every configured origin is tried and the cheapest COMPLETE
 * route wins.
 *
 * ## 🔴 Trap 2 — the export leg is not the price
 *
 * Routing through an HQ is two legs, and only one of them is the export:
 *
 * | route | Srinagar → HQ | HQ → NL | true landed |
 * |---|---|---|---|
 * | via Delhi | ₹206 | ₹1,276 | **₹1,482** |
 * | via Himachal | ₹505 | ₹2,916 | ₹3,421 |
 *
 * Quoting the export leg alone under-quotes by ₹206–₹505 every time, absorbed
 * by us — and it also picks the wrong HQ, because the leg costs do not rank the
 * same way the export costs do. So the domestic leg is rated too and added.
 *
 * ## Why this lives ABOVE the provider
 *
 * The obvious place for this is inside `shiprocket/rate-context.ts`, and that
 * would be wrong. "If the partner's origin cannot be rated, retry from an HQ
 * origin" has nothing to do with Shiprocket — it is a property of how we move
 * goods, and it applies identically to Blue Dart, DTDC and DHL as each gains a
 * rate API. What differs per carrier is COVERAGE: which origins and
 * destinations it will actually carry.
 *
 * So this takes a `rate()` callback and knows about no carrier at all. Today
 * Shiprocket is the only live international rate source, so day one is a
 * Shiprocket-only capability behind a carrier-agnostic seam.
 *
 * ## Where the origins come from
 *
 * `location_ownership.is_core` — the warehouses we already record as ours. Not
 * an environment variable: that made the whole feature inert until somebody
 * remembered to set it, and made "we opened a warehouse" a deploy. A partner
 * who later gets their own pin export-enabled needs no change at all, because
 * a rateable partner origin means the relay never runs.
 *
 * ## 🔴 What it will not do
 *
 * - It never returns 0. A zero is indistinguishable from genuinely free freight
 *   and shipped bulk orders free once already (#1430).
 * - It never sums across currencies. `pickFreightOption` sorts on the raw
 *   amount, so a leg in another currency does not merely fail to help — it wins
 *   by being a smaller number (#1424). A route whose legs disagree on currency
 *   is dropped, not converted: converting needs an FX rate this has no business
 *   holding.
 * - It never silently drops the domestic leg. An HQ route whose first leg could
 *   not be rated is still returned — refusing it would mean falling back to the
 *   flat rate, which is worse — but it is marked `domestic_leg_unrated` and
 *   logged, so the caller can present it as indicative rather than landed.
 */

export type ExportOrigin = {
  /** The pickup pincode handed to the carrier. */
  pincode: string
  /** Human label for logs and the audit trail ("Delhi HQ"). */
  label: string
}

export type RouteLeg = {
  origin_pincode: string
  destination_pincode: string | null
  destination_country: string | null
  amount: number
  currency_code: string
  courier_id: string | null
  courier_name: string | null
  estimated_days: number | null
}

export type RatedRoute = {
  /** The pin the export was actually rated from. */
  origin_pincode: string
  /** Null when this is the partner's own pin — the no-relay route. */
  origin_label: string | null
  /** True when the goods move to an HQ first. */
  via_hq: boolean
  export_leg: RouteLeg
  domestic_leg: RouteLeg | null
  /**
   * 🔴 True when the goods MUST move to the HQ but that leg could not be
   * priced, so `total_amount` is the export leg alone and is an under-quote of
   * unknown size. Never true on a direct route.
   */
  domestic_leg_unrated: boolean
  /** Landed freight: both legs. This is the number a buyer should see. */
  total_amount: number
  currency_code: string
  courier_id: string | null
  courier_name: string | null
  estimated_days: number | null
  is_recommended: boolean
}

/**
 * PURE: turn owned stock locations into export origins.
 *
 * 🔴 A location with no valid 6-digit PIN is DROPPED, not passed through.
 * Shiprocket's international endpoint 400s the whole request without a usable
 * `pickup_postcode`, so a half-filled address would not fail politely on its
 * own row — it would take the retry with it.
 *
 * Deduplicated by pincode: two warehouses in the same PIN are one rate query,
 * not two, and asking twice would just spend a carrier call to learn that.
 */
export function coreOriginsFromLocations(
  locations: Array<{ id?: string; name?: string | null; address?: any }>
): ExportOrigin[] {
  const out: ExportOrigin[] = []
  const seen = new Set<string>()
  for (const loc of locations ?? []) {
    const pincode = String(loc?.address?.postal_code ?? "").trim()
    if (!/^\d{6}$/.test(pincode)) continue
    if (seen.has(pincode)) continue
    seen.add(pincode)
    out.push({ pincode, label: String(loc?.name || `HQ ${pincode}`) })
  }
  return out
}

/**
 * The export origins available to fall back on — our OWN warehouses.
 *
 * ## Why ownership, and not configuration
 *
 * An earlier cut read these from `EXPORT_FALLBACK_ORIGINS`. That made the whole
 * feature inert until somebody remembered to set an environment variable, and
 * made "we opened a warehouse" a deploy. `location_ownership.is_core` already
 * records the exact fact this needs — *we own the stock here* — it is set from
 * the ops UI, and a new hub starts winning the moment it is marked.
 *
 * ⚠️ It is a deliberate CONFLATION: `is_core` was written to answer "may we
 * deduct consumption from this stock", and this reads it as "may we export from
 * here". Those are the same set today (our warehouses) and there is no second
 * table to disagree with. If they ever diverge, this is the line to split.
 *
 * 🔴 A location with NO ownership row is not an origin. The model treats an
 * unrecorded location as not-ours precisely so an unknown location cannot be
 * used by default, and that rule matters more here than it does for stock:
 * `set-location-ownership seed:true` INFERS ownership from partner linkage and
 * infers it wrongly — it proposes marking partner-adjacent locations core while
 * leaving the real Delhi warehouse out. Applying that seed would silently turn
 * a dozen unrelated addresses into export origins. Rows are set one at a time,
 * on purpose.
 *
 * Never throws: an origin lookup that fails means "no fallback available",
 * which degrades to the behaviour that existed before this feature. Failing the
 * whole estimate because a query hiccuped would be a far worse trade.
 */
export async function resolveCoreExportOrigins(scope: any): Promise<ExportOrigin[]> {
  try {
    const { ContainerRegistrationKeys } = await import("@medusajs/framework/utils")
    const ownership: any = scope.resolve("location_ownership")

    const rows = await ownership.listLocationOwnerships(
      { is_core: true },
      { take: null }
    )
    const ids = ((rows ?? []) as any[])
      .map((r) => r?.stock_location_id)
      .filter(Boolean)
    if (!ids.length) return []

    const query: any = scope.resolve(ContainerRegistrationKeys.QUERY)
    // 🔴 Filtered by id. `filters: { id: undefined }` is NO filter rather than
    // "no rows" (#1433) — an empty list must never become every stock location
    // on the platform, which here would export from a partner's own address.
    const { data: locations } = await query.graph({
      entity: "stock_locations",
      fields: ["id", "name", "address.postal_code", "address.country_code"],
      filters: { id: ids },
    })

    return coreOriginsFromLocations((locations ?? []) as any[])
  } catch (e: any) {
    // 🔴 Logged, never silent. A swallowed lookup failure here degrades to
    // "no fallback available", which looks EXACTLY like "correctly configured
    // and not needed" — so the one signal that the feature is broken would be
    // the absence of a signal.
    try {
      const { ContainerRegistrationKeys } = await import(
        "@medusajs/framework/utils"
      )
      scope
        .resolve(ContainerRegistrationKeys.LOGGER)
        ?.warn?.(
          `[export-origins] could not read owned locations (${e?.message ?? e}); ` +
            `no export fallback will be offered on this quote.`
        )
    } catch {
      /* the logger itself is unavailable — nothing further to do */
    }
    return []
  }
}
/** What a carrier answered for one lane. `rate` returns [] for "will not carry". */
export type RateFn = (query: {
  origin_pincode: string
  destination_pincode: string
  destination_country?: string
  weight_grams: number
}) => Promise<
  Array<{
    courier_id?: string | null
    courier_name?: string | null
    amount: number
    currency_code?: string | null
    estimated_days?: number | null
    is_recommended?: boolean
  }>
>

const toLeg = (
  rate: any,
  query: { origin: string; destPin: string | null; destCountry: string | null }
): RouteLeg => ({
  origin_pincode: query.origin,
  destination_pincode: query.destPin,
  destination_country: query.destCountry,
  amount: Number(rate.amount),
  currency_code: String(rate.currency_code || "inr").toLowerCase(),
  courier_id: rate.courier_id ?? null,
  courier_name: rate.courier_name ?? null,
  estimated_days: rate.estimated_days ?? null,
})

/** A rate we would rather have no answer than believe. */
const isUsable = (r: any): boolean =>
  Number.isFinite(Number(r?.amount)) && Number(r.amount) > 0

/** Cheapest first, then by courier name so a tie does not flip between mints. */
const byAmountThenName = (a: RatedRoute, b: RatedRoute): number =>
  a.total_amount - b.total_amount ||
  String(a.courier_name || "").localeCompare(String(b.courier_name || ""))

/**
 * Rate a lane from the partner's own pin AND every configured HQ pin, and
 * return every complete route, cheapest first.
 *
 * Carrier-agnostic by construction: it is handed `rate`, and asks it the same
 * question per origin. A provider that cannot serve an origin must answer with
 * an empty list or throw — either is a clean "no" here, never a 0.
 *
 * The partner's own origin is always tried first and, when it works, is
 * normally the winner: it carries no domestic leg, so it undercuts every relay
 * route on the same carrier. It is not privileged beyond that — if an HQ route
 * genuinely lands cheaper, it wins, which is the whole point of trying all of
 * them.
 */
export async function rateWithOriginFallback(args: {
  partnerOrigin: string
  hqOrigins: ExportOrigin[]
  destinationPincode: string
  destinationCountry?: string | null
  weightGrams: number
  rate: RateFn
  /**
   * Only routes priced in this currency are returned. Omit to accept whatever
   * the carrier answers in, which is right for a single-currency caller and
   * wrong for a quote — see the currency note in the header.
   */
  currencyCode?: string | null
  /**
   * Charge the domestic first leg. Default true: quoting the export leg alone
   * under-quotes every relay route, and it also ranks the HQs wrongly. Set
   * false only if stock demonstrably consolidates at HQ regardless of the
   * order, which makes that leg a genuinely sunk cost.
   */
  chargeDomesticLeg?: boolean
  logger?: { warn?: (m: string) => void; info?: (m: string) => void }
}): Promise<RatedRoute[]> {
  const {
    partnerOrigin,
    hqOrigins,
    destinationPincode,
    weightGrams,
    rate,
    logger,
  } = args
  const destinationCountry = args.destinationCountry
    ? String(args.destinationCountry).toUpperCase()
    : undefined
  const chargeDomesticLeg = args.chargeDomesticLeg !== false
  const wantCurrency = args.currencyCode
    ? String(args.currencyCode).toLowerCase()
    : null

  const askExport = async (origin: string): Promise<any[]> => {
    try {
      const rates = await rate({
        origin_pincode: origin,
        destination_pincode: destinationPincode,
        destination_country: destinationCountry,
        weight_grams: weightGrams,
      })
      return (rates || []).filter(isUsable)
    } catch (e: any) {
      // A carrier refusing an origin is the ordinary case this exists for —
      // Srinagar → NL is a 400, not an outage. Log at info, not warn.
      logger?.info?.(
        `[export-origins] ${origin} → ${
          destinationCountry || destinationPincode
        } could not be rated: ${e?.message ?? e}`
      )
      return []
    }
  }

  /** Currency guard + a stable order. Applied to whichever set we return. */
  const finish = (found: RatedRoute[]): RatedRoute[] => {
    const inCurrency = wantCurrency
      ? found.filter((r) => {
          if (r.currency_code === wantCurrency) return true
          logger?.warn?.(
            `[export-origins] dropped a ${r.currency_code} route (${r.total_amount}) — the quote is in ${wantCurrency}.`
          )
          return false
        })
      : found
    return inCurrency.sort(byAmountThenName)
  }

  const routes: RatedRoute[] = []

  // ---- The partner's own pin ---------------------------------------------
  for (const r of await askExport(partnerOrigin)) {
    const leg = toLeg(r, {
      origin: partnerOrigin,
      destPin: destinationPincode || null,
      destCountry: destinationCountry ?? null,
    })
    routes.push({
      origin_pincode: partnerOrigin,
      origin_label: null,
      via_hq: false,
      export_leg: leg,
      domestic_leg: null,
      domestic_leg_unrated: false,
      total_amount: leg.amount,
      currency_code: leg.currency_code,
      courier_id: leg.courier_id,
      courier_name: leg.courier_name,
      estimated_days: leg.estimated_days,
      is_recommended: !!r.is_recommended,
    })
  }

  /**
   * 🔑 The relay is a FALLBACK, not a comparison.
   *
   * If the partner's own pin can be rated, that is the answer: the goods
   * leave from where they are made, nobody trucks them across the country
   * first, and the quote describes the shipment we would actually book. Only
   * when the carrier refuses that origin — "No serviceable couriers available
   * for given weight", which is a 400, not an empty list — is there a question
   * to ask at all.
   *
   * Rating every origin on every quote and taking the cheapest would also have
   * been defensible, and it is what an earlier cut did. It is wrong for two
   * reasons: it spends a carrier call per hub on lanes that never needed one,
   * and it would silently start relaying shipments through Delhi to save a few
   * hundred rupees on lanes the partner can serve directly — a logistics
   * decision nobody made, arriving as a pricing change.
   */
  if (routes.length) return finish(routes)

  // ---- Every configured HQ pin -------------------------------------------
  for (const hq of hqOrigins) {
    // Rating a relay through the pin we already rated directly is the same
    // route counted twice, with a phantom leg to itself bolted on.
    if (hq.pincode === partnerOrigin) continue

    const exportRates = await askExport(hq.pincode)
    if (!exportRates.length) continue

    // 🔴 Trap 2. Rated once per HQ, not once per courier: the first leg is the
    // same movement whichever courier flies the parcel out.
    let domesticLeg: RouteLeg | null = null
    if (chargeDomesticLeg) {
      try {
        const legRates = (
          await rate({
            origin_pincode: partnerOrigin,
            destination_pincode: hq.pincode,
            weight_grams: weightGrams,
          })
        ).filter(isUsable)
        // Cheapest: the first leg is a commodity movement, not a service the
        // buyer chose.
        const cheapest = legRates.sort(
          (a, b) => Number(a.amount) - Number(b.amount)
        )[0]
        if (cheapest) {
          domesticLeg = toLeg(cheapest, {
            origin: partnerOrigin,
            destPin: hq.pincode,
            destCountry: null,
          })
        }
      } catch (e: any) {
        logger?.warn?.(
          `[export-origins] the first leg ${partnerOrigin} → ${hq.pincode} (${hq.label}) could not be rated: ${e?.message ?? e}`
        )
      }
      if (!domesticLeg) {
        logger?.warn?.(
          `[export-origins] routing via ${hq.label} with NO price for the ` +
            `${partnerOrigin} → ${hq.pincode} leg — the quoted freight is the ` +
            `export leg alone and under-quotes the real movement.`
        )
      }
    }

    for (const r of exportRates) {
      const leg = toLeg(r, {
        origin: hq.pincode,
        destPin: destinationPincode || null,
        destCountry: destinationCountry ?? null,
      })

      // 🔴 Never sum across currencies. Dropped, never converted.
      if (domesticLeg && domesticLeg.currency_code !== leg.currency_code) {
        logger?.warn?.(
          `[export-origins] dropped the ${hq.label} route: its legs are priced ` +
            `in ${domesticLeg.currency_code} and ${leg.currency_code}, and ` +
            `adding them would corrupt the landed total.`
        )
        continue
      }

      routes.push({
        origin_pincode: hq.pincode,
        origin_label: hq.label,
        via_hq: true,
        export_leg: leg,
        domestic_leg: domesticLeg,
        domestic_leg_unrated: chargeDomesticLeg && !domesticLeg,
        total_amount: leg.amount + (domesticLeg?.amount ?? 0),
        currency_code: leg.currency_code,
        courier_id: leg.courier_id,
        courier_name: leg.courier_name,
        estimated_days: leg.estimated_days,
        is_recommended: !!r.is_recommended,
      })
    }
  }

  return finish(routes)
}
