import {
  parseExportOrigins,
  parseExportOriginsStrict,
  rateWithOriginFallback,
} from "../export-origins"

/**
 * #1498 — rating an export from an HQ pin when the partner's cannot be rated.
 *
 * The numbers below are the LIVE probe from 24 Aug 2026 (Shiprocket, 1.2 kg,
 * 30×25×10), not invented fixtures. Using the real ones is what makes the two
 * traps assertable: a made-up pair of HQ prices would rank the same way whether
 * or not the domestic leg is counted, and the test would pass over a defect.
 */
const SRINAGAR = "190001"
const DELHI = "110032"
const HIMACHAL = "176215"

/** Delhi is cheaper to export from; Himachal is cheaper to reach. */
const PROBE = {
  [`${DELHI}->NL`]: 1276,
  [`${HIMACHAL}->NL`]: 2916,
  [`${SRINAGAR}->${DELHI}`]: 206,
  [`${SRINAGAR}->${HIMACHAL}`]: 505,
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
  { pincode: DELHI, label: "Delhi HQ" },
  { pincode: HIMACHAL, label: "Himachal HQ" },
]

describe("parseExportOrigins", () => {
  it("reads pin:label pairs and labels a bare pin", () => {
    expect(parseExportOrigins("110032:Delhi HQ, 176215")).toEqual([
      { pincode: "110032", label: "Delhi HQ" },
      { pincode: "176215", label: "HQ 176215" },
    ])
  })

  it("drops anything that is not a 6-digit PIN, and says what it dropped", () => {
    // A malformed origin passed to the carrier buys a slower no, and on the
    // international endpoint a missing pickup_postcode is a 400 for the whole
    // request rather than for that origin.
    const { origins, rejected } = parseExportOriginsStrict("110032,ABCDEF,1234")
    expect(origins.map((o) => o.pincode)).toEqual(["110032"])
    expect(rejected).toEqual(["ABCDEF", "1234"])
  })

  it("treats a repeated pin as one origin, not two routes", () => {
    expect(parseExportOrigins("110032:Delhi,110032:Delhi again")).toHaveLength(1)
  })

  it("is empty, not throwing, when nothing is configured", () => {
    expect(parseExportOrigins(undefined)).toEqual([])
    expect(parseExportOrigins("")).toEqual([])
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
      expect.arrayContaining(["Delhi HQ", "Himachal HQ"])
    )
    // 1276 + 206 = 1482 beats 2916 + 505 = 3421. A single hardcoded fallback
    // pointed at Himachal would over-quote by 2.3x.
    expect(routes[0].origin_label).toBe("Delhi HQ")
    expect(routes[0].total_amount).toBe(1482)
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
    expect(best.domestic_leg?.amount).toBe(206)
    expect(best.domestic_leg?.destination_pincode).toBe(DELHI)
    // Quoting the export leg alone under-quotes by the first leg, every time.
    expect(best.total_amount).toBe(1482)
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
        [`${SRINAGAR}->${DELHI}`]: 206,
        [`${SRINAGAR}->${HIMACHAL}`]: 505,
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

    // Export alone would pick Himachal (2800 < 2900). Landed picks Delhi
    // (3106 < 3305).
    expect(routes[0].origin_label).toBe("Delhi HQ")
    expect(routes[0].total_amount).toBe(3106)
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
