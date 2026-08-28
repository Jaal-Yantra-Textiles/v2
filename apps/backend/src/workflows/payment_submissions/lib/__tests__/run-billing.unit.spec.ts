import {
  foldPartnerBilling,
  runBillingStatus,
} from "../run-billing"

/**
 * The fold `payable-runs` used inline and `/admin/production-runs/:id/payments`
 * now shares (#1622). Every rule here decides whether someone is paid twice.
 */
describe("foldPartnerBilling", () => {
  const line = (over: Record<string, any> = {}) => ({
    submission: { id: "sub_1", status: "Pending" },
    design_id: "design_1",
    amount: 1000,
    quantity: 1,
    run_provenance: "recorded",
    production_run_ids: ["run_1"],
    ...over,
  })

  it("claims the runs a live line names", () => {
    const { billedRuns } = foldPartnerBilling([line()])

    expect(billedRuns.get("run_1")).toEqual({
      submission_id: "sub_1",
      status: "Pending",
      quantity: 1,
    })
  })

  it("releases the runs of a REJECTED submission", () => {
    // A rejected payout never paid anyone, so its runs are billable again.
    const { billedRuns } = foldPartnerBilling([
      line({ submission: { id: "sub_1", status: "Rejected" } }),
    ])

    expect(billedRuns.has("run_1")).toBe(false)
  })

  it("keeps the FIRST live claim when two lines name one run", () => {
    const { billedRuns } = foldPartnerBilling([
      line({ submission: { id: "sub_first", status: "Paid" } }),
      line({ submission: { id: "sub_second", status: "Pending" } }),
    ])

    expect(billedRuns.get("run_1")?.submission_id).toBe("sub_first")
  })

  it("collects a not_recorded line as DOUBT on its design", () => {
    // The #1565 case: a live payout for run work that never said which run.
    const { designsWithUnrecordedClaims, billedRuns } = foldPartnerBilling([
      line({ run_provenance: "not_recorded", production_run_ids: [] }),
    ])

    expect(billedRuns.size).toBe(0)
    expect(designsWithUnrecordedClaims.get("design_1")).toEqual([
      { submission_id: "sub_1", status: "Pending", amount: 1000 },
    ])
  })

  it("does NOT treat a task payout's missing run as doubt", () => {
    // `no_run` is the one case where absence is an answer.
    const { designsWithUnrecordedClaims } = foldPartnerBilling([
      line({ run_provenance: "no_run", production_run_ids: [] }),
    ])

    expect(designsWithUnrecordedClaims.size).toBe(0)
  })

  it("ignores a REJECTED not_recorded line", () => {
    const { designsWithUnrecordedClaims } = foldPartnerBilling([
      line({
        run_provenance: "not_recorded",
        production_run_ids: [],
        submission: { id: "sub_1", status: "Rejected" },
      }),
    ])

    expect(designsWithUnrecordedClaims.size).toBe(0)
  })

  it("marks a design with an in-flight payout as open, and a Paid one as not", () => {
    const open = foldPartnerBilling([
      line({ submission: { id: "s", status: "Under_Review" } }),
    ])
    const settled = foldPartnerBilling([
      line({ submission: { id: "s", status: "Paid" } }),
    ])

    expect(open.designsWithOpenSubmission.has("design_1")).toBe(true)
    expect(settled.designsWithOpenSubmission.has("design_1")).toBe(false)
  })

  it("reads the submission id off the line when the relation is not expanded", () => {
    const { billedRuns } = foldPartnerBilling([
      line({ submission: null, submission_id: "sub_flat" }),
    ])

    // Status is unknown without the relation — but it is not Rejected, so the
    // claim still holds. Dropping it would report billed work as billable.
    expect(billedRuns.get("run_1")?.submission_id).toBe("sub_flat")
  })
})

describe("runBillingStatus", () => {
  it("says billed when a claim holds the run", () => {
    expect(
      runBillingStatus({ billed: { submission_id: "s" }, unrecordedClaims: [] })
    ).toBe("billed")
  })

  it("says unknown — never clear — when a payout records no run", () => {
    // 🔴 The whole point: ignorance must not be spelled the same way as "no".
    expect(
      runBillingStatus({ billed: null, unrecordedClaims: [{}] })
    ).toBe("unknown")
  })

  it("says clear only when every live payout named its runs", () => {
    expect(runBillingStatus({ billed: null, unrecordedClaims: [] })).toBe("clear")
  })
})
