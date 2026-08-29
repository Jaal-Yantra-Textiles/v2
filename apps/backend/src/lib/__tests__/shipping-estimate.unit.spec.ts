import {
  convertCalculatedRates,
  resolveUnitWeight,
  weightBucketGrams,
} from "../shipping-estimate"

/**
 * The weight rule behind every freight number a buyer sees.
 *
 * A variant with no weight of its own inherits its PRODUCT's (#1394 item 2),
 * which rescues 21 variants platform-wide that are otherwise unquotable. When
 * neither level has one, the estimate refuses — 140 of 183 variants are in that
 * state, so this fires for real, and the gap belongs in the catalogue rather
 * than papered over with a guess.
 */

describe("resolveUnitWeight", () => {
  it("prefers the variant's own weight", () => {
    expect(resolveUnitWeight({ weight: 105, product: { weight: 115 } })).toEqual({
      weight_grams: 105,
      weight_source: "variant",
    })
  })

  it("falls back to the product, and says that it did", () => {
    // 🔑 The over-quote is the reason the source is reported: 115 g against a
    // real 105 g crosses a carrier slab at 200 units.
    expect(resolveUnitWeight({ weight: null, product: { weight: 115 } })).toEqual({
      weight_grams: 115,
      weight_source: "product",
    })
  })

  it("refuses when neither level has a weight", () => {
    expect(resolveUnitWeight({ weight: null, product: { weight: null } })).toBeNull()
  })

  /**
   * The operator's own figure, for a line the catalogue cannot weigh.
   *
   * 🔴 Freight is quoted against the summed basket weight and the estimate
   * refuses the WHOLE basket on the first weightless line — so a design quoted
   * before its garment was ever weighed could not be priced at all. Typing the
   * measured weight is the only way through.
   */
  it("prefers a manual weight over both catalogue levels, and says a human gave it", () => {
    expect(
      resolveUnitWeight({ weight: 105, product: { weight: 115 } }, 250)
    ).toEqual({ weight_grams: 250, weight_source: "manual" })
  })

  it("rescues a line the catalogue cannot weigh at all", () => {
    expect(
      resolveUnitWeight({ weight: null, product: { weight: null } }, 320)
    ).toEqual({ weight_grams: 320, weight_source: "manual" })
  })

  /**
   * 🔑 A blank cell is not a weightless parcel. `Number(undefined)` is NaN and
   * `Number("")` is 0 — both must fall through to the catalogue rather than be
   * taken as an answer, or every untouched row would quote at a carrier's floor
   * the way the `0 INR` freight row shipped bulk orders free (#1430).
   */
  it.each([undefined, null, "", 0, -5, "abc"])(
    "ignores %p and falls back to the catalogue",
    (manual) => {
      expect(
        resolveUnitWeight({ weight: 105, product: { weight: 115 } }, manual)
      ).toEqual({ weight_grams: 105, weight_source: "variant" })
    }
  )

  it("still refuses when neither the catalogue nor the operator has a weight", () => {
    expect(
      resolveUnitWeight({ weight: null, product: { weight: null } }, 0)
    ).toBeNull()
    expect(resolveUnitWeight({})).toBeNull()
  })

  it("treats zero and negative weights as absent, not as a weight", () => {
    expect(resolveUnitWeight({ weight: 0, product: { weight: 115 } })?.weight_source).toBe("product")
    expect(resolveUnitWeight({ weight: -5, product: {} })).toBeNull()
  })

  it("treats an unparseable weight as absent rather than NaN grams", () => {
    expect(resolveUnitWeight({ weight: "heavy", product: { weight: 115 } })).toEqual({
      weight_grams: 115,
      weight_source: "product",
    })
  })

  it("accepts a numeric string, which is how the DB hands back numerics", () => {
    expect(resolveUnitWeight({ weight: "105" })).toEqual({
      weight_grams: 105,
      weight_source: "variant",
    })
  })
})

describe("weightBucketGrams", () => {
  it("rounds up to the next 500 g so a dragged slider shares one cache entry", () => {
    expect(weightBucketGrams(1)).toBe(500)
    expect(weightBucketGrams(500)).toBe(500)
    expect(weightBucketGrams(501)).toBe(1000)
    expect(weightBucketGrams(56_500)).toBe(56_500)
  })

  it("never buckets a real weight down, which would under-quote", () => {
    for (const g of [1, 499, 750, 1001, 12_345]) {
      expect(weightBucketGrams(g)).toBeGreaterThanOrEqual(g)
    }
  })
})

describe("convertCalculatedRates — the drop that guaranteed flat freight (#1498)", () => {
  const inr = (amount: number) => ({
    courier_name: "SRX",
    amount,
    currency_code: "inr",
    source: "calculated" as const,
  })

  it("🔴 converts a carrier rate into the quote currency instead of dropping it", async () => {
    // The measured Srinagar → Berlin lane: ₹3,771 export + ₹286.36 first leg
    // = ₹4,057.36 landed, against a €35 flat that is €35 at 3 kg AND at 22 kg.
    // Dropped, the flat row won by WALKOVER — not by being cheaper, but by
    // being the only survivor.
    const out = await convertCalculatedRates({
      rates: [inr(4057.36)],
      quoteCurrency: "eur",
      lookup: async () => 0.0106,
      convertedAt: "2026-08-24T00:00:00.000Z",
    })

    expect(out).toHaveLength(1)
    expect(out[0].currency_code).toBe("eur")
    // Rounded to the minor unit — left at full precision the total picks up a
    // fraction of a cent no invoice will agree with.
    expect(out[0].amount).toBeCloseTo(43.01, 2)
  })

  it("🔴 records the rate and the original, so the price can be reproduced", async () => {
    // The objection that kept these rates being dropped was "a wrong FX rate is
    // a wrong price wearing a confident label". Recording the working is what
    // answers it — without this, nobody can check a quote after FX has moved.
    const [opt] = await convertCalculatedRates({
      rates: [inr(4057.36)],
      quoteCurrency: "eur",
      lookup: async () => 0.0106,
      convertedAt: "2026-08-24T00:00:00.000Z",
    })

    expect(opt.fx).toEqual({
      original_amount: 4057.36,
      original_currency_code: "inr",
      fx_rate: 0.0106,
      fx_source: "fx_rates",
      converted_at: "2026-08-24T00:00:00.000Z",
    })
  })

  it("🔴 still DROPS a rate it cannot convert — a cold cache is not a guess", async () => {
    // The one thing the original #1424 drop got right, and it must survive.
    const warn = jest.fn()
    const out = await convertCalculatedRates({
      rates: [inr(4057.36)],
      quoteCurrency: "eur",
      lookup: async () => null,
      convertedAt: "2026-08-24T00:00:00.000Z",
      logger: { warn },
    })

    expect(out).toEqual([])
    expect(warn).toHaveBeenCalled()
  })

  it("refuses a zero or negative rate rather than pricing through it", async () => {
    for (const bad of [0, -1, NaN]) {
      expect(
        await convertCalculatedRates({
          rates: [inr(4057.36)],
          quoteCurrency: "eur",
          lookup: async () => bad,
          convertedAt: "2026-08-24T00:00:00.000Z",
        })
      ).toEqual([])
    }
  })

  it("leaves a rate already in the quote currency untouched, with no fx stamp", async () => {
    const lookup = jest.fn(async () => 0.0106)
    const [opt] = await convertCalculatedRates({
      rates: [inr(4057.36)],
      quoteCurrency: "inr",
      lookup,
      convertedAt: "2026-08-24T00:00:00.000Z",
    })

    expect(opt.amount).toBe(4057.36)
    expect(opt.fx).toBeUndefined()
    // An `fx` stamp on an unconverted number would claim a conversion that
    // never happened, and no rate should be fetched at all.
    expect(lookup).not.toHaveBeenCalled()
  })

  it("passes everything through when there is no target currency", async () => {
    // `/store/shipping-estimate` has no quote to denominate against.
    const out = await convertCalculatedRates({
      rates: [inr(100), inr(200)],
      quoteCurrency: "",
      lookup: async () => {
        throw new Error("must not be consulted")
      },
      convertedAt: "2026-08-24T00:00:00.000Z",
    })
    expect(out).toHaveLength(2)
  })

  it("looks a currency up ONCE however many rates share it", async () => {
    // Eight couriers on one lane is eight rates and one exchange rate.
    const lookup = jest.fn(async () => 0.0106)
    await convertCalculatedRates({
      rates: [inr(1000), inr(2000), inr(3000)],
      quoteCurrency: "eur",
      lookup,
      convertedAt: "2026-08-24T00:00:00.000Z",
    })
    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it("🔴 makes the comparison honest, and it now MOVES with weight", async () => {
    // The defect was never "flat wins". It was "flat wins because the
    // alternative was thrown away". Converted, the carrier number enters the
    // comparison and — unlike the flat row — it scales:
    //
    //    3 kg : the real lane is about EUR 43 against a EUR 35 flat
    //   22 kg : the same lane is hundreds, and EUR 35 is still EUR 35
    //
    // So at light weights the flat row wins ON MERIT, and at heavy ones it
    // stops being the answer. Neither was true while the rate was discarded.
    const light = await convertCalculatedRates({
      rates: [inr(4057.36)],
      quoteCurrency: "eur",
      lookup: async () => 0.0106,
      convertedAt: "2026-08-24T00:00:00.000Z",
    })
    const heavy = await convertCalculatedRates({
      rates: [inr(28000)],
      quoteCurrency: "eur",
      lookup: async () => 0.0106,
      convertedAt: "2026-08-24T00:00:00.000Z",
    })

    expect(light[0].amount).toBeCloseTo(43.01, 2)
    expect(heavy[0].amount).toBeCloseTo(296.8, 1)
    // The whole point: the number responds to the consignment.
    expect(heavy[0].amount).toBeGreaterThan(light[0].amount * 5)
  })
})
