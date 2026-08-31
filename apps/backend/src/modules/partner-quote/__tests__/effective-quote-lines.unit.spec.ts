import { effectiveQuoteLines } from "../lib/effective-quote-lines"

/**
 * The basket the buyer's page prices.
 *
 * Written because a field went missing from an inline `.map()` and nothing
 * could see it: `quoted_unit_weight_grams` — the weight the mint was given for
 * a line the catalogue cannot weigh — was dropped, so every DESIGN-led quote
 * refused to price its freight and told the buyer the quote was closed.
 */

const line = (over: Record<string, any> = {}) => ({
  variant_id: "variant_1",
  quantity: 3,
  position: 0,
  note: "Tea towels",
  quoted_unit_weight_grams: 333,
  ...over,
})

describe("effectiveQuoteLines", () => {
  it("🔴 carries the frozen unit weight — a design line has no other source", () => {
    const [l] = effectiveQuoteLines([line()])
    expect(l.unit_weight_grams).toBe(333)
  })

  it("is null, not zero, when the line was never weighed", () => {
    // 🔑 Zero is a weightless consignment, which every carrier rates at its
    // floor. Null means "ask the catalogue", which the estimate can refuse.
    const [l] = effectiveQuoteLines([line({ quoted_unit_weight_grams: null })])
    expect(l.unit_weight_grams).toBeNull()
  })

  it("keeps the weight when the buyer dials a new quantity", () => {
    const [l] = effectiveQuoteLines(
      [line()],
      JSON.stringify([{ variant_id: "variant_1", quantity: 9 }])
    )
    expect(l.quantity).toBe(9)
    expect(l.unit_weight_grams).toBe(333)
  })

  it("leaves undialled lines at their quoted quantity", () => {
    const out = effectiveQuoteLines(
      [line(), line({ variant_id: "variant_2", quantity: 2 })],
      JSON.stringify([{ variant_id: "variant_1", quantity: 9 }])
    )
    expect(out.map((l) => l.quantity)).toEqual([9, 2])
  })

  it("ignores a mangled dial rather than failing the page", () => {
    const out = effectiveQuoteLines([line()], "not json{")
    expect(out[0].quantity).toBe(3)
    expect(out[0].unit_weight_grams).toBe(333)
  })

  it("is empty for an empty quote, and does not throw on null", () => {
    expect(effectiveQuoteLines(null)).toEqual([])
    expect(effectiveQuoteLines(undefined, "[]")).toEqual([])
  })
})
