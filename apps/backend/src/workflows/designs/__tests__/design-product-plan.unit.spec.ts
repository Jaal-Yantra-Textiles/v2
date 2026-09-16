import {
  designProductPlanSchema,
  parseDesignProductPlan,
} from "../design-product-plan"

/**
 * PR4 (#1970). The plan is the contract three mint doors now share — the admin
 * approve route, the bulk run-output approval, and the quote path. Before it,
 * `CreateProductFromDesignInput` was not exported and the quote door cast its
 * input `as any`, so none of these rules were enforced anywhere.
 */
const valid = {
  design_id: "des_1",
  estimated_cost: 850,
  currency_code: "inr",
}

describe("designProductPlanSchema — what may be minted", () => {
  it("accepts the minimum a door must supply", () => {
    const parsed = parseDesignProductPlan(valid)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.plan.design_id).toBe("des_1")
      expect(parsed.plan.currency_code).toBe("inr")
    }
  })

  /**
   * 🔴 The minter still falls back to `input.currency_code || "usd"` on a
   * platform trading in INR and AUD (#1805), and a store default in that slot
   * is what minted INR costs as euros at ~110x (#1979). Requiring it here is
   * what makes that fallback unreachable through this door.
   */
  it("REFUSES a plan with no currency — there is no safe default", () => {
    const parsed = parseDesignProductPlan({ ...valid, currency_code: "" } as any)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.reason).toContain("currency_code")
  })

  it("refuses a currency that is not a 3-letter code", () => {
    expect(parseDesignProductPlan({ ...valid, currency_code: "rupee" }).ok).toBe(false)
  })

  it("normalises the currency, because the minter lowercases", () => {
    const parsed = parseDesignProductPlan({ ...valid, currency_code: " INR " })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.plan.currency_code).toBe("inr")
  })

  /**
   * 🔴 A price of 0 is a claim, not a price (#1900 caught one live).
   * All three doors already refuse this; the schema is where a FOURTH door
   * cannot forget to.
   */
  it("REFUSES a plan that would list at 0", () => {
    const parsed = parseDesignProductPlan({ ...valid, estimated_cost: 0 })
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.reason).toContain("a price of 0 is a claim")
      expect(parsed.reason).toContain("des_1")
    }
  })

  it("accepts a 0 estimate when unit_price carries the price", () => {
    // The quote door's exact shape: estimate 0, priced via unit_price.
    const parsed = parseDesignProductPlan({
      ...valid,
      estimated_cost: 0,
      unit_price: 4200,
      made_to_order: true,
    })
    expect(parsed.ok).toBe(true)
  })

  /** `unit_price` WINS, so a 0 there is not rescued by a positive estimate. */
  it("refuses unit_price 0 even when the estimate is positive", () => {
    const parsed = parseDesignProductPlan({
      ...valid,
      estimated_cost: 850,
      unit_price: 0,
    })
    expect(parsed.ok).toBe(false)
  })

  it("keeps a null unit_price meaning 'use the estimate'", () => {
    const parsed = parseDesignProductPlan({ ...valid, unit_price: null })
    expect(parsed.ok).toBe(true)
  })

  it("refuses a negative or non-finite price", () => {
    expect(parseDesignProductPlan({ ...valid, unit_price: -1 }).ok).toBe(false)
    expect(parseDesignProductPlan({ ...valid, estimated_cost: NaN }).ok).toBe(false)
    expect(parseDesignProductPlan({ ...valid, estimated_cost: Infinity }).ok).toBe(false)
  })

  it("refuses a missing design_id", () => {
    expect(parseDesignProductPlan({ ...valid, design_id: "" }).ok).toBe(false)
  })

  /**
   * A blank size mints `CUSTOM-<id>-` — a trailing separator and no size,
   * which reads like a real SKU.
   */
  it("treats a blank size_label as 'the caller does not know'", () => {
    const parsed = parseDesignProductPlan({ ...valid, size_label: "   " })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.plan.size_label).toBeUndefined()
  })

  it("keeps a real size_label", () => {
    const parsed = parseDesignProductPlan({ ...valid, size_label: "M" })
    if (parsed.ok) expect(parsed.plan.size_label).toBe("M")
  })

  /** `size_label` must stay OPTIONAL — a door that cannot know must not have to. */
  it("does not require size_label", () => {
    expect(designProductPlanSchema.safeParse(valid).success).toBe(true)
  })

  /**
   * `null` means "let the minter route it" — partner-owned designs to their
   * partner's catalogue, everything else to the house store. That is NOT
   * `stores[0]`, the row-0 lottery #2059 removed.
   */
  it("allows a null sales_channel_id but refuses a blank one", () => {
    expect(parseDesignProductPlan({ ...valid, sales_channel_id: null }).ok).toBe(true)
    expect(parseDesignProductPlan({ ...valid, sales_channel_id: "" }).ok).toBe(false)
  })

  it("names every broken field at once, not just the first", () => {
    const parsed = parseDesignProductPlan({
      design_id: "",
      estimated_cost: 0,
      currency_code: "",
    } as any)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.reason).toContain("design_id")
      expect(parsed.reason).toContain("currency_code")
    }
  })
})
