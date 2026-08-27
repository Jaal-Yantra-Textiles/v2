import { resolveListedPrice } from "../create-product-from-design"

/**
 * The price a design is listed at. Medusa 2.x amounts are DECIMAL major units —
 * the seed lists a €10 shirt as `amount: 10` through the same
 * `createProductsWorkflow` this workflow calls.
 */
describe("resolveListedPrice", () => {
  it("lists estimated_cost verbatim — NOT multiplied by 100", () => {
    // The defect: `Math.round(estimated_cost * 100)` listed a ₹850 design at
    // 85,000. This is the whole test.
    expect(resolveListedPrice({ estimated_cost: 850 })).toBe(850)
  })

  it("keeps the decimal part instead of rounding it away", () => {
    // The old code's Math.round applied AFTER the ×100, so 12.34 became 1234.
    // Verbatim, the paise survive.
    expect(resolveListedPrice({ estimated_cost: 12.34 })).toBe(12.34)
  })

  it("prefers unit_price when the quote path supplies one", () => {
    expect(
      resolveListedPrice({ estimated_cost: 850, unit_price: 999 })
    ).toBe(999)
  })

  it("treats the two inputs identically now the multiply is gone", () => {
    expect(resolveListedPrice({ estimated_cost: 850 })).toBe(
      resolveListedPrice({ estimated_cost: 0, unit_price: 850 })
    )
  })

  it("falls through to estimated_cost when unit_price is null or absent", () => {
    expect(resolveListedPrice({ estimated_cost: 40, unit_price: null })).toBe(40)
    expect(resolveListedPrice({ estimated_cost: 40 })).toBe(40)
  })

  it("takes an explicit unit_price of 0 at its word", () => {
    // `!= null`, not truthiness: a deliberate 0 is not "unspecified".
    expect(resolveListedPrice({ estimated_cost: 850, unit_price: 0 })).toBe(0)
  })

  it("floors nonsense at 0 rather than writing it into a price row", () => {
    // The approve route passes `design.estimated_cost || 0`, but the quote path
    // passes whatever the estimator produced.
    expect(resolveListedPrice({ estimated_cost: NaN })).toBe(0)
    expect(resolveListedPrice({ estimated_cost: -5 })).toBe(0)
    expect(
      resolveListedPrice({ estimated_cost: 10, unit_price: Number("nope") })
    ).toBe(0)
  })
})
