import {
  needsCostCurrency,
  storedCost,
} from "../backfill-design-cost-currency-job"

/**
 * Which designs the #1979 backfill will stamp — its entire blast radius.
 *
 * The job fills a blank `cost_currency` on a costed design so approval stops
 * falling back to the store default (EUR here), which listed INR costs as euros
 * at ~110x. Two properties matter more than anything else:
 *
 *  1. it must never OVERWRITE a currency someone stated, and
 *  2. it must actually SELECT the rows on prod — which arrive in three shapes.
 */
describe("storedCost", () => {
  it("reads a plain number", () => {
    expect(storedCost({ estimated_cost: 2634.75 })).toBe(2634.75)
  })

  it("reads a bigNumber-ish string", () => {
    // The column is bigNumber-ish and comes back as a string on some paths.
    expect(storedCost({ estimated_cost: "4000" as any })).toBe(4000)
  })

  it("reads the { value, precision } object the admin API actually returns", () => {
    /*
     * 🔴 The shape observed on prod: `{ value: "4000", precision: 20 }`. A bare
     * `Number()` on it is NaN, which would score as "no cost" and silently
     * skip every such row — the job would report success having done nothing.
     */
    expect(storedCost({ estimated_cost: { value: "4000", precision: 20 } as any })).toBe(
      4000
    )
  })

  it("treats absent and unparseable as no cost, never NaN", () => {
    expect(storedCost({})).toBe(0)
    expect(storedCost({ estimated_cost: null })).toBe(0)
    expect(storedCost({ estimated_cost: "" as any })).toBe(0)
    expect(storedCost({ estimated_cost: "abc" as any })).toBe(0)
    expect(storedCost({ estimated_cost: {} as any })).toBe(0)
  })
})

describe("needsCostCurrency", () => {
  it("selects a costed design with no currency — the 45 on prod", () => {
    expect(needsCostCurrency({ estimated_cost: 2634.75, cost_currency: null })).toBe(true)
    expect(needsCostCurrency({ estimated_cost: 2634.75 })).toBe(true)
    expect(
      needsCostCurrency({ estimated_cost: { value: "960", precision: 20 } as any })
    ).toBe(true)
  })

  it("selects blank-but-not-null currencies", () => {
    /*
     * '' is falsy but is not null — the shape that defeated an `is not null`
     * CHECK elsewhere in this codebase — and "   " is not a statement either.
     * Both would otherwise be carried into the price as an empty currency code.
     */
    expect(needsCostCurrency({ estimated_cost: 100, cost_currency: "" })).toBe(true)
    expect(needsCostCurrency({ estimated_cost: 100, cost_currency: "   " })).toBe(true)
  })

  it("🔴 NEVER selects a design that already states a currency", () => {
    /*
     * The assertion that makes the job safe to re-run and safe to mis-scope.
     * The two designs stamped by hand while #1979 was being diagnosed must be
     * untouchable, and so must a design deliberately costed in another currency.
     */
    expect(needsCostCurrency({ estimated_cost: 2634.75, cost_currency: "inr" })).toBe(
      false
    )
    expect(needsCostCurrency({ estimated_cost: 570.4, cost_currency: "aud" })).toBe(false)
    expect(needsCostCurrency({ estimated_cost: 100, cost_currency: "EUR" })).toBe(false)
  })

  it("does NOT select a design with no cost", () => {
    /*
     * Nothing to denominate. Stamping a currency onto an uncosted design would
     * state something we do not know — and 83 of the 130 designs on prod are
     * in exactly that state.
     */
    expect(needsCostCurrency({ cost_currency: null })).toBe(false)
    expect(needsCostCurrency({ estimated_cost: null, cost_currency: null })).toBe(false)
    expect(needsCostCurrency({ estimated_cost: 0, cost_currency: null })).toBe(false)
    expect(needsCostCurrency({ estimated_cost: "0" as any, cost_currency: null })).toBe(
      false
    )
  })

  it("does not select a negative or unparseable cost", () => {
    expect(needsCostCurrency({ estimated_cost: -5, cost_currency: null })).toBe(false)
    expect(needsCostCurrency({ estimated_cost: "abc" as any, cost_currency: null })).toBe(
      false
    )
  })
})
