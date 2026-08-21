import {
  planQuotePrices,
  priceListScopedToGroup,
} from "../lib/plan-quote-prices"

/**
 * The money half of quote minting (#1389 S3). Both functions here exist to make
 * a dangerous default impossible, so those are the cases that matter.
 */

describe("planQuotePrices", () => {
  it("turns each quoted line into one price row at its quantity", () => {
    const rows = planQuotePrices(
      [
        { variant_id: "var_a", quantity: 500, quoted_unit_amount: 12.5 },
        { variant_id: "var_b", quantity: 200, quoted_unit_amount: 30 },
      ],
      "inr"
    )

    expect(rows).toEqual([
      { variant_id: "var_a", currency_code: "inr", amount: 12.5, min_quantity: 500, max_quantity: null },
      { variant_id: "var_b", currency_code: "inr", amount: 30, min_quantity: 200, max_quantity: null },
    ])
  })

  it("🔴 DROPS a line with no quoted amount — never writes it as zero", () => {
    // A zero here would not fail loudly. It would become an ACTIVE price of
    // zero that the cart charges, which is the worst failure this file has.
    const rows = planQuotePrices(
      [
        { variant_id: "var_a", quantity: 500, quoted_unit_amount: null },
        { variant_id: "var_b", quantity: 500 },
        { variant_id: "var_c", quantity: 500, quoted_unit_amount: 10 },
      ],
      "inr"
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].variant_id).toBe("var_c")
  })

  it("leaves the ceiling open — 600 ordered still earns the 500 tier", () => {
    const [row] = planQuotePrices(
      [{ variant_id: "var_a", quantity: 500, quoted_unit_amount: 12 }],
      "inr"
    )
    expect(row.min_quantity).toBe(500)
    expect(row.max_quantity).toBeNull()
  })

  it("collapses a duplicated variant+quantity to the cheapest, as core would", () => {
    const rows = planQuotePrices(
      [
        { variant_id: "var_a", quantity: 500, quoted_unit_amount: 14 },
        { variant_id: "var_a", quantity: 500, quoted_unit_amount: 11 },
      ],
      "inr"
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].amount).toBe(11)
  })

  it("keeps two rows for the same variant at DIFFERENT quantities — that is a ladder", () => {
    const rows = planQuotePrices(
      [
        { variant_id: "var_a", quantity: 100, quoted_unit_amount: 14 },
        { variant_id: "var_a", quantity: 500, quoted_unit_amount: 11 },
      ],
      "inr"
    )
    expect(rows).toHaveLength(2)
  })

  it("skips junk quantities and missing variant ids rather than guessing", () => {
    const rows = planQuotePrices(
      [
        { variant_id: "var_a", quantity: 0, quoted_unit_amount: 10 },
        { variant_id: "var_a", quantity: -5, quoted_unit_amount: 10 },
        { variant_id: "", quantity: 500, quoted_unit_amount: 10 },
        { variant_id: "var_b", quantity: Number.NaN, quoted_unit_amount: 10 },
      ],
      "inr"
    )
    expect(rows).toEqual([])
  })

  it("returns nothing for an empty basket instead of throwing", () => {
    expect(planQuotePrices([], "inr")).toEqual([])
  })
})

describe("priceListScopedToGroup", () => {
  it("🔴 treats rules_count = 0 as UNSCOPED — that list prices for everyone", () => {
    expect(priceListScopedToGroup({ rules_count: 0 }, "cg_1")).toBe(false)
  })

  it("treats a missing list as unscoped — the dangerous default must be false", () => {
    expect(priceListScopedToGroup(null, "cg_1")).toBe(false)
  })

  it("accepts a list ruled to the buyer's group", () => {
    expect(
      priceListScopedToGroup(
        {
          rules_count: 1,
          price_list_rules: [
            { attribute: "customer_group_id", value: [{ value: "cg_1" }] },
          ],
        },
        "cg_1"
      )
    ).toBe(true)
  })

  it("rejects a list ruled to somebody ELSE's group", () => {
    expect(
      priceListScopedToGroup(
        {
          rules_count: 1,
          price_list_rules: [
            { attribute: "customer_group_id", value: [{ value: "cg_other" }] },
          ],
        },
        "cg_1"
      )
    ).toBe(false)
  })

  it("trusts a positive rules_count when the rules were not expanded", () => {
    // The count is the weaker signal, but it is the one that decides "applies
    // to all", so a positive count without the expansion is not a failure.
    expect(priceListScopedToGroup({ rules_count: 1 }, "cg_1")).toBe(true)
  })
})
