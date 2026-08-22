import { composeQuoteMoney, frozenMoney } from "../lib/build-quote-view"
import { foldTaxLines, unknownTaxReason } from "../lib/quote-tax"

/**
 * Tax on a quote (#1439 S8).
 *
 * Two assertions carry this file.
 *
 * 1. **Inclusive vs exclusive is an 18% error in the confident direction.**
 *    When the prices already contain the tax, adding it again overcharges the
 *    buyer by exactly the tax; when they do not, failing to add it under-quotes
 *    a number the buyer is budgeting against. Both directions are pinned.
 * 2. **Unknown is never zero.** `tax_total` and `gross_total` stay null
 *    whenever the tax could not be determined, so no caller can add a
 *    fabricated zero into a total. A quote that says "0 tax" is making a claim.
 */

describe("foldTaxLines", () => {
  const goods = [{ id: "var_a", amount: 1000, on: "goods" as const }]
  const withFreight = [
    ...goods,
    { id: "quote-freight", amount: 200, on: "freight" as const },
  ]
  const gst = (id: string) => ({
    line_item_id: id,
    rate: 18,
    code: "IN-GST",
    name: "India GST",
  })

  it("adds tax on top when the prices are tax-EXCLUSIVE", () => {
    const { total } = foldTaxLines(goods, [gst("var_a")], false)
    expect(total).toBe(180)
  })

  it("EXTRACTS tax from the price when they are tax-INCLUSIVE", () => {
    // 1000 gross at 18% is 152.54 of tax, not 180 — the difference is the tax
    // on the tax, and adding 180 here would overcharge every Indian quote.
    const { total } = foldTaxLines(goods, [gst("var_a")], true)
    expect(total).toBeCloseTo(152.54, 2)
  })

  it("taxes the freight leg as well as the goods", () => {
    const lines = [gst("var_a"), { ...gst("x"), line_item_id: undefined, shipping_line_id: "quote-freight" }]
    const { total, rates } = foldTaxLines(withFreight, lines as any, false)
    expect(total).toBe(216) // 180 on goods + 36 on freight
    // Two entries at the SAME percentage: "18% on goods" and "18% on freight"
    // are facts a buyer reads separately.
    expect(rates.map((r) => r.on).sort()).toEqual(["freight", "goods"])
  })

  it("ignores a taxable item the module returned no line for", () => {
    // A zero-rated region returns a line AT rate 0; no line at all means the
    // item was not matched, and inventing tax for it would be worse than none.
    const { total, rates } = foldTaxLines(withFreight, [gst("var_a")], false)
    expect(total).toBe(180)
    expect(rates).toHaveLength(1)
  })

  it("carries a configured ZERO rate through as a real, calculated zero", () => {
    const { total, rates } = foldTaxLines(
      goods,
      [{ line_item_id: "var_a", rate: 0, code: "GB-ZERO", name: "Zero rated" }],
      false
    )
    // 🔑 This zero is a fact — a region that says "0%". It is a different
    // thing from the null a missing region produces, and only one of the two
    // may be shown to a buyer as a number.
    expect(total).toBe(0)
    expect(rates[0].code).toBe("GB-ZERO")
  })

  it("names the destination when it has to say it does not know", () => {
    expect(unknownTaxReason("gb")).toContain("GB")
    expect(unknownTaxReason("")).toContain("this destination")
  })
})

describe("composeQuoteMoney with tax", () => {
  const lines = [1000]

  it("leaves tax UNKNOWN when none was resolved — never zero", () => {
    const money = composeQuoteMoney(lines, 10, 200)
    expect(money.landed_total).toBe(1200)
    // Both null: a caller that adds these gets NaN and notices, which is the
    // point. A 0 would silently become "no tax due".
    expect(money.tax_total).toBeNull()
    expect(money.gross_total).toBeNull()
  })

  it("ADDS tax to the gross when prices are tax-exclusive", () => {
    const money = composeQuoteMoney(lines, 10, 200, {
      total: 216,
      inclusive: false,
    })
    expect(money.landed_total).toBe(1200)
    expect(money.gross_total).toBe(1416)
  })

  it("🔴 does NOT add tax again when prices are tax-inclusive", () => {
    const money = composeQuoteMoney(lines, 10, 200, {
      total: 183.05,
      inclusive: true,
    })
    // The tax is already inside the 1200. Adding it would overcharge the buyer
    // by the whole tax amount.
    expect(money.gross_total).toBe(1200)
    // …and it is still disclosed, because a buyer reclaiming input credit
    // needs the figure.
    expect(money.tax_total).toBe(183.05)
  })

  it("keeps landed_total meaning exactly what it always meant", () => {
    // Widening it would silently change every frozen `quoted_landed_total`
    // already on disk and every comparison drawn against one.
    const taxed = composeQuoteMoney(lines, 10, 200, { total: 216, inclusive: false })
    const untaxed = composeQuoteMoney(lines, 10, 200)
    expect(taxed.landed_total).toBe(untaxed.landed_total)
  })
})

describe("frozenMoney with tax", () => {
  const base = {
    quoted_subtotal: 1000,
    quoted_freight: 200,
    quoted_landed_total: 1200,
    lines: [{ variant_id: "var_a", quantity: 10 }],
  }

  it("reports UNKNOWN tax for a quote minted before tax existed", () => {
    const money = frozenMoney(base as any)
    // Those rows genuinely have no tax figure. Defaulting to 0 would
    // retroactively assert that an untaxed quote was tax-free.
    expect(money?.tax_total).toBeNull()
    expect(money?.gross_total).toBeNull()
  })

  it("reads a frozen tax figure back on its recorded basis", () => {
    const exclusive = frozenMoney({
      ...base,
      quoted_tax_total: 216,
      quoted_tax_inclusive: false,
    } as any)
    expect(exclusive?.gross_total).toBe(1416)

    const inclusive = frozenMoney({
      ...base,
      quoted_tax_total: 183.05,
      quoted_tax_inclusive: true,
    } as any)
    expect(inclusive?.gross_total).toBe(1200)
  })
})
