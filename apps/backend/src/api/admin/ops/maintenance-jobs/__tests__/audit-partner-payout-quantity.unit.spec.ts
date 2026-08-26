import {
  classifyPayoutLine,
  resolveBackingRun,
  UNPAID_STATUSES,
} from "../audit-partner-payout-quantity-job"

/**
 * #1554 — a per-piece rate was billed once. These cover the two decisions the
 * job makes before it is allowed to touch money: which run backs a line, and
 * whether that line is short.
 */
describe("classifyPayoutLine", () => {
  const run = {
    quantity: 9,
    partner_cost_estimate: 850,
    cost_type: "per_unit" as const,
  }

  it("calls a line that billed the unit rate underbilled", () => {
    expect(classifyPayoutLine({ amount: 850, run })).toMatchObject({
      verdict: "underbilled",
      expected: 7650,
      unit_amount: 850,
      quantity: 9,
    })
  })

  it("calls a line that billed the payable total correct", () => {
    expect(classifyPayoutLine({ amount: 7650, run }).verdict).toBe("correct")
  })

  /**
   * 🔑 The distinction that keeps the report honest. On a run of one the
   * per-unit cost and the payable total are the same number, so the line is
   * evidence of nothing. Folding it into "correct" would let the report claim
   * the defect was absent where it merely could not be observed.
   */
  it("refuses to call a single-unit run either right or wrong", () => {
    const single = { ...run, quantity: 1 }
    expect(classifyPayoutLine({ amount: 850, run: single }).verdict).toBe(
      "single_unit"
    )
  })

  it("reports a line matching neither figure as unmatched, not as a defect", () => {
    expect(classifyPayoutLine({ amount: 1234, run }).verdict).toBe("unmatched")
  })

  it("tolerates paise-level drift from the numeric round-trip", () => {
    expect(classifyPayoutLine({ amount: 7650.01, run }).verdict).toBe("correct")
    expect(classifyPayoutLine({ amount: 850.02, run }).verdict).toBe("underbilled")
  })

  it("handles a total-typed run, where the unit rate is derived", () => {
    const total = { quantity: 4, partner_cost_estimate: 400, cost_type: "total" as const }
    // 400 total over 4 units = 100/unit. A line that billed 100 is short.
    expect(classifyPayoutLine({ amount: 100, run: total })).toMatchObject({
      verdict: "underbilled",
      expected: 400,
      unit_amount: 100,
    })
  })
})

describe("resolveBackingRun", () => {
  const base = {
    design_id: "des_1",
    status: "completed",
    run_type: "production",
    partner_cost_estimate: 850,
    cost_type: "per_unit" as const,
    quantity: 9,
  }

  it("prefers the run id recorded on the submission over any inference", () => {
    const result = resolveBackingRun({
      design_id: "des_1",
      recorded_run_id: "run_b",
      runs: [
        { ...base, id: "run_a" },
        { ...base, id: "run_b" },
      ],
    })
    expect(result).toMatchObject({ basis: "recorded" })
    expect(result?.run.id).toBe("run_b")
  })

  it("accepts a sole completed run", () => {
    const result = resolveBackingRun({
      design_id: "des_1",
      runs: [{ ...base, id: "run_a" }],
    })
    expect(result).toMatchObject({ basis: "sole_run" })
  })

  /**
   * 🔴 The refusal that matters. "Take the latest" would attribute a payment
   * to a run it may not have been for — and this job exists to stop guessing
   * at amounts, not to guess faster.
   */
  it("refuses two candidate runs rather than picking one", () => {
    expect(
      resolveBackingRun({
        design_id: "des_1",
        runs: [
          { ...base, id: "run_a" },
          { ...base, id: "run_b" },
        ],
      })
    ).toBeNull()
  })

  it("ignores samples, unfinished runs and runs with no cost", () => {
    for (const spoiler of [
      { run_type: "sample" },
      { status: "in_progress" },
      { partner_cost_estimate: 0 },
    ]) {
      expect(
        resolveBackingRun({
          design_id: "des_1",
          runs: [{ ...base, id: "run_a", ...spoiler }],
        })
      ).toBeNull()
    }
  })

  it("ignores a run belonging to a different design", () => {
    expect(
      resolveBackingRun({
        design_id: "des_1",
        runs: [{ ...base, id: "run_a", design_id: "des_2" }],
      })
    ).toBeNull()
  })

  it("falls through to inference when the recorded id names a run we did not load", () => {
    const result = resolveBackingRun({
      design_id: "des_1",
      recorded_run_id: "run_missing",
      runs: [{ ...base, id: "run_a" }],
    })
    expect(result).toMatchObject({ basis: "sole_run" })
  })
})

describe("UNPAID_STATUSES", () => {
  /**
   * 🔴 The guard that stops the job editing settled money. A Paid or Approved
   * submission records what was actually paid; rewriting it would make our
   * books disagree with reality without moving a rupee.
   */
  it("covers only the statuses whose money has not moved", () => {
    expect([...UNPAID_STATUSES]).toEqual(["Draft", "Pending"])
    for (const settled of ["Approved", "Paid", "Under_Review", "Rejected"]) {
      expect(UNPAID_STATUSES as readonly string[]).not.toContain(settled)
    }
  })
})
