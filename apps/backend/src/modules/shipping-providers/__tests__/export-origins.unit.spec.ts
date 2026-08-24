import {
  coreOriginsFromLocations,
  rateWithOriginFallback,
} from "../export-origins"

/**
 * #1498 — rating an export from an HQ pin when the partner's cannot be rated.
 *
 * The numbers below are the LIVE probe from 24 Aug 2026 (Shiprocket, 1.2 kg,
 * 30×25×10), against the pins prod actually holds as `location_ownership`
 * core rows — not invented fixtures. Using the real ones is what makes the two
 * traps assertable: a made-up pair of hub prices would rank the same way
 * whether or not the domestic leg is counted, and the test would pass over a
 * defect.
 *
 *   190001 Srinagar (partner) → NL : "No serviceable couriers available"
 *   110096 JYT HQ Delhi       → NL : 8 couriers, cheapest ₹1,276
 *   176215 Dharamshala        → NL : 1 courier,  ₹2,916
 *   190001 → 110096 (first leg)    : ₹206.36
 *   190001 → 176215 (first leg)    : ₹505.05
 *
 * ⚠️ The international serviceability response nests the amount at
 * `courier.rate.rate` — `courier.rate` is an OBJECT. Reading it one level too
 * shallow yields NaN, which once made every international quote come out 0.
 */
const SRINAGAR = "190001"
const DELHI = "110096"
const HIMACHAL = "176215"

/** Delhi is cheaper to export from; Himachal is cheaper to reach. */
const PROBE = {
  [`${DELHI}->NL`]: 1276,
  [`${HIMACHAL}->NL`]: 2916,
  [`${SRINAGAR}->${DELHI}`]: 206.36,
  [`${SRINAGAR}->${HIMACHAL}`]: 505.05,
}

/** Srinagar cannot export: the live endpoint answers 400, not an empty list. */
const fakeRate = (opts: { throwOn?: string[]; empty?: string[] } = {}) =>
  jest.fn(async (q: any) => {
    const key = q.destination_country
      ? `${q.origin_pincode}->${q.destination_country}`
      : `${q.origin_pincode}->${q.destination_pincode}`
    if (opts.throwOn?.includes(key)) {
      throw new Error("No serviceable couriers available for given weight")
    }
    if (opts.empty?.includes(key)) return []
    const amount = (PROBE as any)[key]
    if (!amount) return []
    return [
      {
        courier_id: `c-${key}`,
        courier_name: `Courier ${key}`,
        amount,
        currency_code: "inr",
        estimated_days: 6,
        is_recommended: true,
      },
    ]
  })

const HQ = [
  { pincode: DELHI, label: "JYT HQ Delhi" },
  { pincode: HIMACHAL, label: "Dharamshala" },
]

describe("coreOriginsFromLocations", () => {
  it("turns owned warehouses into origins, labelled by name", () => {
    expect(
      coreOriginsFromLocations([
        { id: "sloc_a", name: "JYT HQ Delhi", address: { postal_code: "110096" } },
        { id: "sloc_b", name: "Dharamshala", address: { postal_code: "176215" } },
      ])
    ).toEqual([
      { pincode: "110096", label: "JYT HQ Delhi" },
      { pincode: "176215", label: "Dharamshala" },
    ])
  })

  it("🔴 drops a warehouse whose address has no usable PIN", () => {
    // Shiprocket's international endpoint 400s the WHOLE request without a
    // usable pickup_postcode, so a half-filled address does not fail politely
    // on its own row — it takes the retry with it.
    expect(
      coreOriginsFromLocations([
        { id: "a", name: "No address", address: null },
        { id: "b", name: "Short pin", address: { postal_code: "1100" } },
        { id: "c", name: "Not a pin", address: { postal_code: "SW1A 1AA" } },
        { id: "d", name: "Good", address: { postal_code: "110096" } },
      ]).map((o) => o.pincode)
    ).toEqual(["110096"])
  })

  it("treats two warehouses in one PIN as one origin", () => {
    // Two rate queries for the same pin is a carrier call spent learning that
    // they are the same pin.
    expect(
      coreOriginsFromLocations([
        { id: "a", name: "Delhi A", address: { postal_code: "110096" } },
        { id: "b", name: "Delhi B", address: { postal_code: "110096" } },
      ])
    ).toHaveLength(1)
  })

  it("is empty, not throwing, when nothing is owned", () => {
    expect(coreOriginsFromLocations([])).toEqual([])
    expect(coreOriginsFromLocations(undefined as any)).toEqual([])
  })
})

describe("rateWithOriginFallback", () => {
  it("rates the export from an HQ when the partner's own pin 400s", async () => {
    const rate = fakeRate({ throwOn: [`${SRINAGAR}->NL`] })
    const routes = await rateWithOriginFallback({
      partnerOrigin: SRINAGAR,
      hqOrigins: HQ,
      destinationPincode: "1011AB",
      destinationCountry: "NL",
      weightGrams: 1200,
      rate,
      currencyCode: "inr",
    })

    // Without this the lane has no carrier answer at all and falls to the flat
    // rate, which is why international freight read flat at any weight.
    expect(routes.length).toBeGreaterThan(0)
    expect(routes[0].via_hq).toBe(true)
  })

  it("🔴 trap 1: tries EVERY HQ rather than one, and takes the cheapest", async () => {
    const rate = fakeRate({ throwOn: [`${SRINAGAR}->NL`] })
    const routes = await rateWithOriginFallback({
      partnerOrigin: SRINAGAR,
      hqOrigins: HQ,
      destinationPincode: "1011AB",
      destinationCountry: "NL",
      weightGrams: 1200,
      rate,
      currencyCode: "inr",
    })

    expect(routes.map((r) => r.origin_label)).toEqual(
      expect.arrayContaining(["JYT HQ Delhi", "Dharamshala"])
    )
    // 1276 + 206.36 = 1482.36 beats 2916 + 505.05 = 3421.05. A single hardcoded
    // fallback pointed at Dharamshala would over-quote by 2.3x.
    expect(routes[0].origin_label).toBe("JYT HQ Delhi")
    expect(routes[0].total_amount).toBeCloseTo(1482.36, 2)
  })

  it("🔴 trap 2: the total is BOTH legs, and both are recorded", async () => {
    const rate = fakeRate({ throwOn: [`${SRINAGAR}->NL`] })
    const [best] = await rateWithOriginFallback({
      partnerOrigin: SRINAGAR,
      hqOrigins: HQ,
      destinationPincode: "1011AB",
      destinationCountry: "NL",
      weightGrams: 1200,
      rate,
      currencyCode: "inr",
    })

    expect(best.export_leg.amount).toBe(1276)
    expect(best.domestic_leg?.amount).toBeCloseTo(206.36, 2)
    expect(best.domestic_leg?.destination_pincode).toBe(DELHI)
    // Quoting the export leg alone under-quotes by the first leg, every time.
    expect(best.total_amount).toBeCloseTo(1482.36, 2)
    expect(best.domestic_leg_unrated).toBe(false)
  })

  it("🔴 trap 2, ranking: the legs re-order the HQs, they do not just shift them", async () => {
    // The point of counting the first leg is not a bigger number, it is a
    // DIFFERENT winner where the cheap export is far from the partner. Delhi
    // exports cheaper but from here Himachal is nearer — invert the export
    // prices and the ranking must follow the landed total, not the export.
    const rate = jest.fn(async (q: any) => {
      const key = q.destination_country
        ? `${q.origin_pincode}->${q.destination_country}`
        : `${q.origin_pincode}->${q.destination_pincode}`
      const table: Record<string, number> = {
        [`${DELHI}->NL`]: 2900,
        [`${HIMACHAL}->NL`]: 2800,
        [`${SRINAGAR}->${DELHI}`]: 206.36,
        [`${SRINAGAR}->${HIMACHAL}`]: 505.05,
      }
      if (key === `${SRINAGAR}->NL`) throw new Error("no couriers")
      const amount = table[key]
      return amount
        ? [{ courier_name: key, amount, currency_code: "inr" }]
        : []
    })

    const routes = await rateWithOriginFallback({
      partnerOrigin: SRINAGAR,
      hqOrigins: HQ,
      destinationPincode: "1011AB",
      destinationCountry: "NL",
      weightGrams: 1200,
      rate,
      currencyCode: "inr",
    })

    // Export alone would pick Dharamshala (2800 < 2900). Landed picks Delhi
    // (3106.36 < 3305.05).
    expect(routes[0].origin_label).toBe("JYT HQ Delhi")
    expect(routes[0].total_amount).toBeCloseTo(3106.36, 2)
  })

  it("🔴 does not ask a single hub when the partner's own pin rates", async () => {
    // The relay is a FALLBACK, not a comparison. Rating every hub on every
    // quote would spend a carrier call per hub on lanes that never needed one,
    // and would silently start routing shipments through Delhi to save a few
    // hundred rupees on lanes the partner can serve directly — a logistics
    // decision nobody made, arriving as a pricing change.
    const rate = jest.fn(async (q: any) =>
      q.origin_pincode === SRINAGAR
        ? [{ courier_name: "Direct", amount: 9999, currency_code: "inr" }]
        : [{ courier_name: "Relay", amount: 10, currency_code: "inr" }]
    )

    const routes = await rateWithOriginFallback({
      partnerOrigin: SRINAGAR,
      hqOrigins: HQ,
      destinationPincode: "1011AB",
      destinationCountry: "NL",
      weightGrams: 1200,
      rate,
      currencyCode: "inr",
    })

    // Even though a hub would be 1000x cheaper, it is never asked.
    expect(rate).toHaveBeenCalledTimes(1)
    expect(routes).toHaveLength(1)
    expect(routes[0].via_hq).toBe(false)
    expect(routes[0].total_amount).toBe(9999)
  })

  it("prefers the partner's own pin once it becomes serviceable, with no code change", async () => {
    // The configured HQ list does not need editing when a partner's own pin is
    // export-enabled: a direct route pays no first leg, so it undercuts.
    const rate = jest.fn(async (q: any) => {
      const key = q.destination_country
        ? `${q.origin_pincode}->${q.destination_country}`
        : `${q.origin_pincode}->${q.destination_pincode}`
      const table: Record<string, number> = {
        [`${SRINAGAR}->NL`]: 1400,
        ...PROBE,
      }
      const amount = table[key]
      return amount
        ? [{ courier_name: key, amount, currency_code: "inr" }]
        : []
    })

    const routes = await rateWithOriginFallback({
      partnerOrigin: SRINAGAR,
      hqOrigins: HQ,
      destinationPincode: "1011AB",
      destinationCountry: "NL",
      weightGrams: 1200,
      rate,
      currencyCode: "inr",
    })

    expect(routes[0].via_hq).toBe(false)
    expect(routes[0].origin_pincode).toBe(SRINAGAR)
    expect(routes[0].total_amount).toBe(1400)
  })

  it("does not rate a relay through the partner's own pin", async () => {
    const rate = fakeRate()
    await rateWithOriginFallback({
      partnerOrigin: DELHI,
      hqOrigins: HQ,
      destinationPincode: "1011AB",
      destinationCountry: "NL",
      weightGrams: 1200,
      rate,
      currencyCode: "inr",
    })
    const legs = rate.mock.calls.map((c: any[]) => c[0])
    expect(
      legs.some(
        (l: any) => l.origin_pincode === DELHI && l.destination_pincode === DELHI
      )
    ).toBe(false)
  })

  it("🔴 never returns a zero, whatever the carrier answers", async () => {
    // A zero is indistinguishable from genuinely free freight, and shipped bulk
    // orders free once already (#1430).
    const rate = jest.fn(async () => [
      { courier_name: "Bogus", amount: 0, currency_code: "inr" },
    ])
    const routes = await rateWithOriginFallback({
      partnerOrigin: SRINAGAR,
      hqOrigins: HQ,
      destinationPincode: "1011AB",
      destinationCountry: "NL",
      weightGrams: 1200,
      rate,
      currencyCode: "inr",
    })
    expect(routes).toEqual([])
  })

  it("🔴 refuses to add legs priced in different currencies", async () => {
    const rate = jest.fn(async (q: any) =>
      q.destination_country
        ? [{ courier_name: "Intl", amount: 35, currency_code: "eur" }]
        : [{ courier_name: "Dom", amount: 206, currency_code: "inr" }]
    )
    const routes = await rateWithOriginFallback({
      partnerOrigin: SRINAGAR,
      hqOrigins: [HQ[0]],
      destinationPincode: "1011AB",
      destinationCountry: "NL",
      weightGrams: 1200,
      rate,
      // Srinagar answers EUR too, so the direct route survives the currency
      // filter; only the mixed-currency RELAY must be dropped.
      currencyCode: "eur",
    })
    expect(routes.every((r) => !r.via_hq)).toBe(true)
  })

  it("keeps a route whose first leg could not be priced, but marks it", async () => {
    // Refusing it would drop the lane to the flat rate, which is worse. It must
    // not be presented as a landed price though.
    const rate = fakeRate({
      throwOn: [`${SRINAGAR}->NL`],
      empty: [`${SRINAGAR}->${DELHI}`, `${SRINAGAR}->${HIMACHAL}`],
    })
    const warn = jest.fn()
    const routes = await rateWithOriginFallback({
      partnerOrigin: SRINAGAR,
      hqOrigins: HQ,
      destinationPincode: "1011AB",
      destinationCountry: "NL",
      weightGrams: 1200,
      rate,
      currencyCode: "inr",
      logger: { warn },
    })

    expect(routes[0].domestic_leg).toBeNull()
    expect(routes[0].domestic_leg_unrated).toBe(true)
    expect(routes[0].total_amount).toBe(1276)
    expect(warn).toHaveBeenCalled()
  })

  it("skips the first leg entirely when it is declared a sunk cost", async () => {
    const rate = fakeRate({ throwOn: [`${SRINAGAR}->NL`] })
    const routes = await rateWithOriginFallback({
      partnerOrigin: SRINAGAR,
      hqOrigins: HQ,
      destinationPincode: "1011AB",
      destinationCountry: "NL",
      weightGrams: 1200,
      rate,
      currencyCode: "inr",
      chargeDomesticLeg: false,
    })

    expect(routes[0].total_amount).toBe(1276)
    expect(routes[0].domestic_leg).toBeNull()
    // Not "unrated" — nobody failed to price it, we chose not to charge it.
    expect(routes[0].domestic_leg_unrated).toBe(false)
  })

  it("returns nothing when no origin can be rated at all", async () => {
    const rate = jest.fn(async () => {
      throw new Error("no couriers")
    })
    const routes = await rateWithOriginFallback({
      partnerOrigin: SRINAGAR,
      hqOrigins: HQ,
      destinationPincode: "1011AB",
      destinationCountry: "NL",
      weightGrams: 1200,
      rate,
      currencyCode: "inr",
    })
    // The caller falls back to its flat rate — this must not manufacture one.
    expect(routes).toEqual([])
  })
})
