import { resolveUnitWeight, weightBucketGrams } from "../shipping-estimate"

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
