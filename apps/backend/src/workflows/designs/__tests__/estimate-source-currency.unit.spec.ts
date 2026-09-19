import { estimateSourceCurrency } from "../create-draft-order-from-designs"

/**
 * #2176 — a design order priced a rupee estimate as euros.
 *
 * The design carried the answer the whole time. `Tibetan Chupa Style Shirt` has
 * `estimated_cost: 10000` and `cost_currency: "inr"`, and the draft-order step
 * tagged its estimate with nothing — so the conversion step fell back to the
 * HOUSE store's currency, which is EUR while 12 of 15 storefronts sell in INR.
 * The resulting cart line kept the evidence in its own metadata:
 * `original_currency: "eur"` on an `inr` cart.
 */
describe("estimateSourceCurrency", () => {
  it("takes the design's own cost currency", () => {
    expect(estimateSourceCurrency({ cost_currency: "inr" })).toBe("inr")
  })

  it("the live regression: an INR design is never reported as anything else", () => {
    // The exact row from prod.
    const design = { cost_currency: "inr" }
    expect(estimateSourceCurrency(design)).toBe("inr")
    expect(estimateSourceCurrency(design)).not.toBe("eur")
  })

  it("lower-cases, because currencies are compared as lower-case everywhere else", () => {
    expect(estimateSourceCurrency({ cost_currency: "EUR" })).toBe("eur")
    expect(estimateSourceCurrency({ cost_currency: " Inr " })).toBe("inr")
  })

  /**
   * 🔴 undefined, NOT a guess. The caller falls back to the house store for a
   * design that predates the column; returning a default here would hide that
   * a denomination was never recorded.
   */
  it("returns undefined when the design has no currency, rather than defaulting", () => {
    expect(estimateSourceCurrency({ cost_currency: null })).toBeUndefined()
    expect(estimateSourceCurrency({})).toBeUndefined()
    expect(estimateSourceCurrency(null)).toBeUndefined()
    expect(estimateSourceCurrency(undefined)).toBeUndefined()
  })

  /**
   * An empty string is not a denomination. It would pass a naive truthiness
   * check on the caller's side and label money with nothing — the `''` passes
   * `is not null` shape.
   */
  it("treats an empty or whitespace currency as absent", () => {
    expect(estimateSourceCurrency({ cost_currency: "" })).toBeUndefined()
    expect(estimateSourceCurrency({ cost_currency: "   " })).toBeUndefined()
  })

  it("ignores a non-string currency rather than stringifying it", () => {
    expect(estimateSourceCurrency({ cost_currency: 0 as any })).toBeUndefined()
    expect(estimateSourceCurrency({ cost_currency: {} as any })).toBeUndefined()
  })
})
