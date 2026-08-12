import { assessRunPayout, runPayableAmount } from "../lib/run-payable"

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
    })
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
})
