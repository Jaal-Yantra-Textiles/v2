import {
  resolveDesignLineAmount,
  sanitizeQuantities,
} from "../create-payment-submission"

/**
 * #1554 — a per-piece rate was billed once.
 *
 * `design.estimated_cost` / `production_cost` are PER FINISHED UNIT
 * (`workflows/designs/estimate-design-cost.ts` divides a run total back to
 * per-unit for exactly that reason), and this workflow used that figure as the
 * whole line amount. A design costed at 850/unit and produced nine times billed
 * 850.
 *
 * 🔑 The first test below is the one that matters: it fails against the old
 * `amount: design.estimated_cost`, which returned 850. Confirmed red before
 * this change landed — a test that only passes on the new code proves nothing
 * about the bug it claims to cover.
 */
describe("resolveDesignLineAmount", () => {
  it("multiplies the per-unit cost by the quantity", () => {
    expect(resolveDesignLineAmount({ unit_cost: 850, quantity: 9 })).toEqual({
      amount: 7650,
      quantity: 9,
      unit_amount: 850,
    })
  })

  // The whole point of the change: the total is not the rate.
  it("does not bill one piece for a nine-piece run", () => {
    const line = resolveDesignLineAmount({ unit_cost: 850, quantity: 9 })
    expect(line.amount).not.toBe(850)
  })

  /**
   * ⚠️ The compatibility guarantee. Every existing caller passes no quantity,
   * and this function must leave those amounts byte-for-byte unchanged —
   * otherwise the fix silently re-prices live submissions.
   */
  it("bills exactly the per-unit cost when no quantity is supplied", () => {
    expect(resolveDesignLineAmount({ unit_cost: 850 })).toEqual({
      amount: 850,
      quantity: 1,
      unit_amount: 850,
    })
  })

  /**
   * 🔴 #456 in the other direction: an override is ALREADY a total (the
   * auto-draft's runPayableAmount figure, or a number the partner typed).
   * Multiplying it again gave 850/unit → 7650 → 68850.
   */
  it("takes a total override verbatim and never re-multiplies it", () => {
    expect(
      resolveDesignLineAmount({ unit_cost: 850, quantity: 9, override: 7650 })
    ).toEqual({ amount: 7650, quantity: 9, unit_amount: null })
  })

  it("records no unit rate behind a typed total", () => {
    // Dividing 7650 by 9 would produce a rate nobody agreed to. Absent is honest.
    const line = resolveDesignLineAmount({ unit_cost: 0, quantity: 4, override: 999 })
    expect(line.unit_amount).toBeNull()
  })

  it("prefers a caller-supplied rate over the design's stored cost", () => {
    // The partner typed 900 at completion; the design still says 850. The
    // agreed price is the one that was agreed, not the one on file.
    expect(
      resolveDesignLineAmount({ unit_cost: 850, quantity: 3, unit_override: 900 })
    ).toEqual({ amount: 2700, quantity: 3, unit_amount: 900 })
  })

  it("lets a total override outrank a supplied rate", () => {
    const line = resolveDesignLineAmount({
      unit_cost: 850,
      quantity: 9,
      unit_override: 900,
      override: 5000,
    })
    expect(line.amount).toBe(5000)
  })

  it("rounds money to two decimals rather than trailing float dust", () => {
    expect(
      resolveDesignLineAmount({ unit_cost: 10.005, quantity: 3 }).amount
    ).toBe(30.02)
  })

  it("bills nothing, and claims no rate, when there is no cost at all", () => {
    expect(resolveDesignLineAmount({ unit_cost: 0, quantity: 5 })).toEqual({
      amount: 0,
      quantity: 5,
      unit_amount: null,
    })
  })

  it("ignores a nonsense quantity rather than zeroing or inverting a line", () => {
    for (const quantity of [0, -3, NaN, null, undefined]) {
      expect(resolveDesignLineAmount({ unit_cost: 100, quantity }).amount).toBe(100)
    }
  })
})

describe("sanitizeQuantities", () => {
  it("keeps positive finite quantities", () => {
    expect(sanitizeQuantities({ des_1: 9, des_2: "4" })).toEqual({
      des_1: 9,
      des_2: 4,
    })
  })

  // A zero must not survive: it would multiply a real line down to nothing.
  it("drops zero, negative and unparseable values", () => {
    expect(
      sanitizeQuantities({ a: 0, b: -2, c: "nine", d: null, e: {} })
    ).toEqual({})
  })

  it("survives a non-object", () => {
    expect(sanitizeQuantities(null)).toEqual({})
    expect(sanitizeQuantities("9")).toEqual({})
  })
})
