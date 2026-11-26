import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { resolveShippingProvider } from "../../modules/shipping-providers/resolver"
import { SHIPROCKET_PICKUP_METADATA_KEY } from "../../modules/shipping-providers/pickup-locations"
import type { DelhiveryProviderAdapter } from "../../modules/shipping-providers/delhivery/adapter"
import { resolveUnitWeight } from "../shipping-estimate"
import {
  type CarrierAnswer,
  type DeliveryCheckResult,
  codFromRates,
  etaFromRates,
  mergeDeliveryAnswers,
} from "./merge"

/**
 * `GET /store/delivery-check` — "do you deliver to my PIN, roughly when, and can
 * I pay cash?" Read-only: every carrier call here is a lookup (pin-codes,
 * serviceability, rate quote). Nothing is created at any carrier.
 *
 * Which carrier answers what is decided in `merge.ts`. This file does the
 * plumbing around it: which location we ship from, the parcel weight, the
 * cache, and the guards that keep a public route from turning into a carrier
 * bill or a 500.
 *
 * ⚠️ The publishable key identifies the store; it does not protect the route
 * (it ships in the storefront bundle). So: 12h cache per lane, one in-flight
 * call per lane, a per-carrier call budget per minute, and a hard timeout per
 * call. A carrier that fails, times out or is over budget becomes
 * `serviceable: null` with a soft message — never an error.
 */

const CACHE_TTL_SECONDS = 12 * 60 * 60
/** A lane where a carrier failed is only cached briefly, so it can recover. */
const DEGRADED_TTL_SECONDS = 5 * 60
const CARRIER_TIMEOUT_MS = 8000
/** Per carrier, per process. Delhivery's pin-code API allows far more; this is a cost cap. */
const CARRIER_CALLS_PER_MINUTE = 60
const DEFAULT_WEIGHT_GRAMS = 500

export type DeliveryCheckInput = {
  store: { id: string; default_location_id?: string | null } | null
  sales_channel_ids: string[]
  country_code: string
  postal_code: string
  variant_id?: string
  cart_id?: string
}

// ---- Bounding ------------------------------------------------------------

const callLog = new Map<string, number[]>()

/** Sliding-window budget. Returns false when the carrier is over its minute. */
export function takeCarrierBudget(
  carrier: string,
  now = Date.now(),
  limit = CARRIER_CALLS_PER_MINUTE
): boolean {
  const recent = (callLog.get(carrier) ?? []).filter((t) => now - t < 60_000)
  if (recent.length >= limit) {
    callLog.set(carrier, recent)
    return false
  }
  recent.push(now)
  callLog.set(carrier, recent)
  return true
}

export function resetDeliveryCheckState() {
  callLog.clear()
  inFlight.clear()
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })

const inFlight = new Map<string, Promise<DeliveryCheckResult>>()

// ---- Carriers ------------------------------------------------------------

const isNotConfigured = (e: any) =>
  /not configured/i.test(String(e?.message || ""))

async function askCarrier(
  scope: any,
  carrier: string,
  ask: (provider: any) => Promise<Omit<Extract<CarrierAnswer, { status: "ok" }>, "carrier" | "status">>
): Promise<CarrierAnswer> {
  let provider: any
  try {
    provider = await resolveShippingProvider(scope, carrier)
  } catch (e: any) {
    if (isNotConfigured(e)) return { carrier, status: "not_configured" }
    return { carrier, status: "error", reason: String(e?.message || e) }
  }
  if (!takeCarrierBudget(carrier)) {
    return { carrier, status: "error", reason: "over the per-minute call budget" }
  }
  try {
    const answer = await withTimeout(ask(provider), CARRIER_TIMEOUT_MS)
    return { carrier, status: "ok", ...answer }
  } catch (e: any) {
    return { carrier, status: "error", reason: String(e?.message || e) }
  }
}

const ratesAnswer = (rates: any[] | null | undefined, domestic: boolean) => {
  const list = rates ?? []
  return {
    serviceable: list.length > 0,
    cod: domestic ? codFromRates(list) : false,
    eta_days: etaFromRates(list),
    courier_count: list.length,
  }
}

// ---- Store context -------------------------------------------------------

type Origin = { location_id: string | null; pincode: string | null; zone_countries: Set<string> }

/**
 * Where this store ships from.
 *
 * 1. The store's `default_location_id` — the same origin the freight estimate
 *    quotes from, and on a partner store it is the partner's own location.
 * 2. Otherwise the locations linked to the store's sales channel, but ONLY if
 *    exactly one of them has a usable Indian pin (or exactly one is registered
 *    as a Shiprocket pickup). Picking `[0]` of several would quote some other
 *    warehouse's lane — or a supplier's.
 *
 * No origin is not fatal: Delhivery's pin lookup doesn't need one; only the
 * Shiprocket quote is skipped.
 */
async function resolveOrigin(scope: any, input: DeliveryCheckInput): Promise<Origin> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)

  let locationIds: string[] = []
  if (input.store?.default_location_id) {
    locationIds = [input.store.default_location_id]
  } else if (input.sales_channel_ids.length) {
    const { data: links } = await query.graph({
      entity: "sales_channel_location",
      fields: ["stock_location_id"],
      filters: { sales_channel_id: input.sales_channel_ids },
      pagination: { skip: 0, take: 50 },
    })
    locationIds = [
      ...new Set<string>((links ?? []).map((l: any) => l.stock_location_id).filter(Boolean)),
    ]
  }
  // 🔴 Never query with an empty id list: `filters: { id: [] }`/undefined can
  // read every tenant's locations (#1397).
  if (!locationIds.length) {
    return { location_id: null, pincode: null, zone_countries: new Set() }
  }

  const { data: locations } = await query.graph({
    entity: "stock_locations",
    fields: [
      "id",
      "metadata",
      "address.postal_code",
      "address.country_code",
      "fulfillment_sets.type",
      "fulfillment_sets.service_zones.geo_zones.country_code",
    ],
    filters: { id: locationIds },
  })

  const zoneCountries = new Set<string>()
  for (const loc of locations ?? []) {
    for (const set of loc.fulfillment_sets ?? []) {
      if (set?.type === "pickup") continue
      for (const zone of set?.service_zones ?? []) {
        for (const g of zone?.geo_zones ?? []) {
          if (g?.country_code) zoneCountries.add(String(g.country_code).toLowerCase())
        }
      }
    }
  }

  const usable = (locations ?? []).filter(
    (l: any) =>
      /^[1-9][0-9]{5}$/.test(String(l?.address?.postal_code || "").trim()) &&
      String(l?.address?.country_code || "in").toLowerCase() === "in"
  )
  let chosen: any = null
  if (usable.length === 1) {
    chosen = usable[0]
  } else if (usable.length > 1) {
    const registered = usable.filter(
      (l: any) => l?.metadata?.[SHIPROCKET_PICKUP_METADATA_KEY]
    )
    if (registered.length === 1) chosen = registered[0]
  }

  return {
    location_id: chosen?.id ?? (locationIds.length === 1 ? locationIds[0] : null),
    pincode: chosen ? String(chosen.address.postal_code).trim() : null,
    zone_countries: zoneCountries,
  }
}

/** Parcel weight in grams: the variant's, the cart's lines, or 500 g. */
async function resolveWeight(scope: any, input: DeliveryCheckInput): Promise<number> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  try {
    if (input.cart_id) {
      const { data: carts } = await query.graph({
        entity: "cart",
        fields: [
          "id",
          "sales_channel_id",
          "items.quantity",
          "items.variant.weight",
          "items.variant.product.weight",
        ],
        filters: { id: input.cart_id },
      })
      const cart = carts?.[0]
      // Only this store's carts. Nothing about the cart is returned, but a
      // foreign cart id must not shape another store's answer either.
      if (cart && input.sales_channel_ids.includes(cart.sales_channel_id)) {
        const grams = (cart.items ?? []).reduce((sum: number, item: any) => {
          const w = item?.variant ? resolveUnitWeight(item.variant) : null
          return sum + (w?.weight_grams ?? 0) * (Number(item?.quantity) || 0)
        }, 0)
        if (grams > 0) return grams
      }
    } else if (input.variant_id) {
      const { data: variants } = await query.graph({
        entity: "variant",
        fields: ["id", "weight", "product.weight"],
        filters: { id: input.variant_id },
      })
      const w = variants?.[0] ? resolveUnitWeight(variants[0]) : null
      if (w) return w.weight_grams
    }
  } catch {
    /* weight is a refinement; never fail the check over it */
  }
  return DEFAULT_WEIGHT_GRAMS
}

/** Coarse buckets so near-identical parcels share a cache entry. */
export function weightBucket(grams: number): number {
  const steps = [500, 1000, 2000, 5000, 10000]
  return steps.find((s) => grams <= s) ?? Math.ceil(grams / 5000) * 5000
}

// ---- Entry point ---------------------------------------------------------

export async function runDeliveryCheck(
  scope: any,
  input: DeliveryCheckInput
): Promise<DeliveryCheckResult & { cache_hit: boolean }> {
  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)
  const country = input.country_code.toLowerCase()
  const domestic = country === "in"

  const [origin, grams] = await Promise.all([
    resolveOrigin(scope, input),
    resolveWeight(scope, input),
  ])
  const bucket = weightBucket(grams)

  const key = `delivery-check:v1:${origin.location_id ?? "none"}:${country}:${input.postal_code}:${bucket}`

  let cache: any = null
  try {
    cache = scope.resolve(Modules.CACHING)
  } catch {
    cache = null
  }
  const hit = cache ? await cache.get({ key }).catch(() => null) : null
  if (hit) return { ...(hit as DeliveryCheckResult), cache_hit: true }

  const pending = inFlight.get(key)
  if (pending) return { ...(await pending), cache_hit: true }

  const work = (async (): Promise<DeliveryCheckResult> => {
    const answers: CarrierAnswer[] = []

    if (domestic) {
      answers.push(
        ...(await Promise.all([
          askCarrier(scope, "delhivery", async (p: DelhiveryProviderAdapter) => {
            const pin = await p.checkPinCode(input.postal_code)
            return { serviceable: pin.serviceable, cod: pin.cod, eta_days: null }
          }),
          origin.pincode
            ? askCarrier(scope, "shiprocket", async (p) =>
                ratesAnswer(
                  await p.getRates({
                    origin_pincode: origin.pincode!,
                    destination_pincode: input.postal_code,
                    destination_country: "IN",
                    weight_grams: bucket,
                    cod: false,
                  }),
                  true
                )
              )
            : skipWithoutOrigin(scope, "shiprocket"),
        ]))
      )
    } else {
      answers.push(
        ...(await Promise.all([
          origin.pincode
            ? askCarrier(scope, "shiprocket", async (p) =>
                ratesAnswer(
                  await p.getRates({
                    origin_pincode: origin.pincode!,
                    destination_pincode: input.postal_code,
                    destination_country: country.toUpperCase(),
                    weight_grams: bucket,
                    cod: false,
                  }),
                  false
                )
              )
            : skipWithoutOrigin(scope, "shiprocket"),
          // ShipGlobal rates from its own hub — no origin needed.
          askCarrier(scope, "shipglobal", async (p) =>
            ratesAnswer(
              await p.getRates({
                origin_pincode: "",
                destination_pincode: input.postal_code,
                destination_country: country.toUpperCase(),
                weight_grams: bucket,
              }),
              false
            )
          ),
        ]))
      )
    }

    for (const a of answers) {
      if (a.status === "error") {
        logger.warn(
          `[delivery-check] ${a.carrier} failed for ${country}/${input.postal_code}: ${a.reason}`
        )
      }
    }

    const result = mergeDeliveryAnswers({
      country_code: country,
      postal_code: input.postal_code,
      answers,
      zone_covers_country: origin.zone_countries.size
        ? origin.zone_countries.has(country)
        : origin.location_id
          ? false
          : null,
    })

    const degraded = answers.some((a) => a.status === "error")
    if (cache) {
      await cache
        .set({
          key,
          data: result,
          ttl: degraded ? DEGRADED_TTL_SECONDS : CACHE_TTL_SECONDS,
        })
        .catch(() => {})
    }
    return result
  })()

  inFlight.set(key, work)
  try {
    return { ...(await work), cache_hit: false }
  } finally {
    inFlight.delete(key)
  }
}

/**
 * Shiprocket is configured but this store has no ship-from pin to quote from.
 * That is a store setup gap, not "Shiprocket says no" — report it as a failed
 * answer so it can't turn into a confident "we don't deliver".
 */
async function skipWithoutOrigin(scope: any, carrier: string): Promise<CarrierAnswer> {
  try {
    await resolveShippingProvider(scope, carrier)
  } catch (e: any) {
    if (isNotConfigured(e)) return { carrier, status: "not_configured" }
  }
  return {
    carrier,
    status: "error",
    reason: "the store has no single ship-from location with an Indian pin code",
  }
}
