import { assessRunPayout, runPayableAmount, runUnitCost } from "../lib/run-payable"

describe("runPayableAmount", () => {
  it("multiplies a per-unit cost by the ORDERED quantity", () => {
    expect(
      runPayableAmount({
        quantity: 9,
        produced_quantity: 7,
        partner_cost_estimate: 850,
        cost_type: "per_unit",
      } as any)
    ).toBe(7650)
  })

  it("takes a total cost verbatim", () => {
    expect(
      runPayableAmount({
        quantity: 9,
        partner_cost_estimate: 7650,
        cost_type: "total",
      })
    ).toBe(7650)
  })

  it("treats a missing cost_type as a total", () => {
    expect(
      runPayableAmount({ quantity: 9, partner_cost_estimate: 500 })
    ).toBe(500)
  })

  it("falls back to one unit when a per-unit run has no quantity", () => {
    expect(
      runPayableAmount({ partner_cost_estimate: 500, cost_type: "per_unit" })
    ).toBe(500)
  })

  it("rounds to two decimals", () => {
    expect(
      runPayableAmount({
        quantity: 3,
        partner_cost_estimate: 10.005,
        cost_type: "per_unit",
      })
    ).toBe(30.02)
  })

  it("is zero for a run with no usable cost", () => {
    expect(runPayableAmount({ quantity: 5 })).toBe(0)
    expect(runPayableAmount({ partner_cost_estimate: 0 })).toBe(0)
    expect(runPayableAmount({ partner_cost_estimate: -5 })).toBe(0)
    expect(runPayableAmount(null)).toBe(0)
  })
})

describe("assessRunPayout", () => {
  const completed = {
    id: "run_1",
    status: "completed",
    design_id: "des_1",
    partner_id: "part_1",
    quantity: 4,
    partner_cost_estimate: 100,
    cost_type: "per_unit" as const,
  }

  it("accepts a completed run with a design, a partner and a cost", () => {
    expect(assessRunPayout(completed)).toEqual({
      eligible: true,
      design_id: "des_1",
      partner_id: "part_1",
      amount: 400,
      quantity: 4,
      unit_amount: 100,
    })
  })

  // The breakdown exists so a payment line can say "4 x 100". If it did not
  // reconcile with the total it would be worse than absent: a partner would be
  // shown arithmetic that does not produce the number they were paid.
  it("returns a breakdown that reproduces the total, for both cost types", () => {
    const perUnit = assessRunPayout(completed)
    const total = assessRunPayout({
      ...completed,
      cost_type: "total",
      partner_cost_estimate: 400,
    })

    for (const payout of [perUnit, total]) {
      if (!payout.eligible) throw new Error("expected an eligible payout")
      expect(payout.unit_amount * payout.quantity).toBeCloseTo(payout.amount, 2)
    }
  })

  it("divides a total back out to a per-unit rate", () => {
    const payout = assessRunPayout({
      ...completed,
      cost_type: "total",
      quantity: 4,
      partner_cost_estimate: 7650,
    })
    if (!payout.eligible) throw new Error("expected an eligible payout")
    expect(payout.amount).toBe(7650)
    expect(payout.unit_amount).toBe(1912.5)
  })

  // A per-unit run with no quantity bills one unit (runPayableAmount's own
  // fallback). The breakdown has to agree, or it would claim a quantity the
  // total was never multiplied by.
  it("reports one unit when a per-unit run carries no quantity", () => {
    const payout = assessRunPayout({ ...completed, quantity: null })
    if (!payout.eligible) throw new Error("expected an eligible payout")
    expect(payout).toMatchObject({ amount: 100, quantity: 1, unit_amount: 100 })
  })

  it("refuses a run that has not completed", () => {
    expect(assessRunPayout({ ...completed, status: "in_progress" })).toEqual({
      eligible: false,
      reason: "run_not_completed",
    })
  })

  it("refuses a run with no design or no partner", () => {
    expect(assessRunPayout({ ...completed, design_id: null })).toEqual({
      eligible: false,
      reason: "no_design",
    })
    expect(assessRunPayout({ ...completed, partner_id: null })).toEqual({
      eligible: false,
      reason: "no_partner",
    })
  })

  it("refuses a run with no agreed cost rather than drafting a zero", () => {
    expect(
      assessRunPayout({ ...completed, partner_cost_estimate: null })
    ).toEqual({ eligible: false, reason: "no_cost" })
  })

  it("refuses a missing run", () => {
    expect(assessRunPayout(null)).toEqual({
      eligible: false,
      reason: "run_not_found",
    })
  })

  /**
   * #1606 — a run minted by a retail fulfilment passes every other check here:
   * completed, a design, a partner, a cost. It shipped from stock, so no
   * shop-floor work happened inside it and paying for it invents labour.
   *
   * 🔑 Nothing emits `production_run.completed` for one today
   * (`complete-provenance-run` deliberately stays silent), so this guard is
   * defensive — it is what stops a phantom payout the day that changes.
   */
  it("refuses a run minted by a retail fulfilment", () => {
    expect(
      assessRunPayout({
        ...completed,
        metadata: { source: "order.fulfillment_created", design_backed: true },
      })
    ).toEqual({ eligible: false, reason: "provenance_run" })
  })

  it("still pays a real run that merely carries other metadata", () => {
    const verdict = assessRunPayout({
      ...completed,
      metadata: { source: "partner_dispatch", note: "rush" },
    })
    expect(verdict.eligible).toBe(true)
  })
})

/**
 * #1554 — `updateDesignOnCompleteStep` wrote `partner_cost_estimate` RAW into
 * `design.production_cost` / `estimated_cost`, which are PER FINISHED UNIT
 * columns. A run of 9 completed at 7650 TOTAL stamped 7650 as the per-unit
 * cost. Per-unit runs happened to land correctly; total runs did not.
 *
 * 🔑 The first two tests fail against the old `cost_value: partner_cost_estimate`.
 */
describe("runUnitCost", () => {
  it("divides a total by the ordered quantity", () => {
    expect(
      runUnitCost({ quantity: 9, partner_cost_estimate: 7650, cost_type: "total" })
    ).toBe(850)
  })

  it("reads an absent cost_type as a total, like every other reader does", () => {
    // Matches getActualProductionCostStep: `cost_type === "per_unit" ? est : est / qty`.
    // Splitting from that convention would make the design disagree with the
    // estimator about what the same run cost.
    expect(runUnitCost({ quantity: 4, partner_cost_estimate: 400 })).toBe(100)
  })

  it("takes a per-unit cost verbatim", () => {
    expect(
      runUnitCost({ quantity: 9, partner_cost_estimate: 850, cost_type: "per_unit" })
    ).toBe(850)
  })

  it("is the inverse of runPayableAmount", () => {
    const run = {
      quantity: 9,
      partner_cost_estimate: 850,
      cost_type: "per_unit" as const,
    }
    expect(runUnitCost(run) * 9).toBeCloseTo(runPayableAmount(run), 2)
  })

  it("falls back to one unit when a total run has no quantity", () => {
    expect(runUnitCost({ partner_cost_estimate: 500, cost_type: "total" })).toBe(500)
  })

  it("is zero for a run with no usable cost", () => {
    expect(runUnitCost({ quantity: 5 })).toBe(0)
    expect(runUnitCost({ partner_cost_estimate: -5 })).toBe(0)
    expect(runUnitCost(null)).toBe(0)
  })
})
