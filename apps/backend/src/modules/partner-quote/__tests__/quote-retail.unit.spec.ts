import { composeQuoteRetail } from "../lib/quote-retail"

/**
 * The reseller's block (#1428 follow-up).
 *
 * 🔴 The assertions that matter are the ones about NOT reporting a margin. A
 * list price we could not resolve, and a list price at or below what the buyer
 * negotiated, are both "no margin story" — and both have an obvious wrong
 * answer that renders perfectly: 0%. A margin of zero stated as a fact reads as
 * "not worth reselling", which is a conclusion we have no business drawing on
 * the buyer's behalf.
 */

const line = (over: Record<string, any> = {}) => ({
  variant_id: "var_1",
  product_title: "Kashida Shawl",
  quantity: 10,
  unit_amount: 900,
  product_tags: ["handloom"],
  ...over,
})

describe("composeQuoteRetail", () => {
  it("reports the spread between the list price and the buyer's", () => {
    const out = composeQuoteRetail({
      currency_code: "inr",
      lines: [line()],
      listPrices: new Map([["var_1", 1500]]),
    })

    expect(out).toBeTruthy()
    expect(out!.lines[0].list_unit_amount).toBe(1500)
    expect(out!.lines[0].unit_margin).toBe(600)
    expect(out!.lines[0].margin_pct).toBe(40)
    expect(out!.total_at_list).toBe(15000)
    expect(out!.total_at_your_price).toBe(9000)
    expect(out!.total_margin).toBe(6000)
    expect(out!.margin_pct).toBe(40)
  })

  it("🔴 renders NOTHING when no line has a list price", () => {
    expect(
      composeQuoteRetail({
        currency_code: "inr",
        lines: [line()],
        listPrices: new Map(),
      })
    ).toBeNull()
  })

  it("🔴 renders nothing when the buyer negotiated to or past the list price", () => {
    // 0% is the plausible wrong answer here, and it is editorial.
    expect(
      composeQuoteRetail({
        currency_code: "inr",
        lines: [line({ unit_amount: 1500 })],
        listPrices: new Map([["var_1", 1500]]),
      })
    ).toBeNull()

    expect(
      composeQuoteRetail({
        currency_code: "inr",
        lines: [line({ unit_amount: 1800 })],
        listPrices: new Map([["var_1", 1500]]),
      })
    ).toBeNull()
  })

  it("keeps a line with no list price alongside one that has it", () => {
    const out = composeQuoteRetail({
      currency_code: "inr",
      lines: [line(), line({ variant_id: "var_2", product_title: "Stole" })],
      listPrices: new Map([["var_1", 1500]]),
    })

    expect(out!.lines).toHaveLength(2)
    // Absent, never zero — the buyer must be able to see which line we could
    // not price rather than reading it as a zero-margin item.
    expect(out!.lines[1].list_unit_amount).toBeNull()
    expect(out!.lines[1].unit_margin).toBeNull()
    expect(out!.lines[1].margin_pct).toBeNull()
  })

  it("collects the catalogue's words across the basket, deduped and ordered", () => {
    const out = composeQuoteRetail({
      currency_code: "inr",
      lines: [
        line({ product_tags: ["handloom", "silk"] }),
        line({ variant_id: "var_2", product_tags: ["silk", "  ", "cashmere"] }),
      ],
      listPrices: new Map([["var_1", 1500]]),
    })

    expect(out!.tags).toEqual(["cashmere", "handloom", "silk"])
  })

  it("skips a line whose price is not a number rather than counting it as zero", () => {
    const out = composeQuoteRetail({
      currency_code: "inr",
      lines: [line(), line({ variant_id: "var_2", unit_amount: null })],
      listPrices: new Map([["var_1", 1500]]),
    })

    expect(out!.lines).toHaveLength(1)
    expect(out!.total_at_your_price).toBe(9000)
  })
})
