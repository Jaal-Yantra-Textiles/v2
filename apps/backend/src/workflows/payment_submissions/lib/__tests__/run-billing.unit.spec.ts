import {
  foldPartnerBilling,
  runBillableRemaining,
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
      // #1596 — the claim carries how MUCH of the run it took, so a screen can
      // offer what is left instead of reporting the whole run as billed.
      claimed_quantity: 1,
      claimed_wholly: false,
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

/**
 * #1596 — how much of a run is left, and the status a screen branches on.
 *
 * The write guard accepts the remainder of a partly-claimed run. Reporting it
 * as `billed` is what left the last units of a short-completed run unbillable
 * through any screen: the workflow said yes and nothing would ask.
 */
describe("runBillableRemaining / runBillingStatus (#1596)", () => {
  const line = (over: Record<string, any> = {}) => ({
    submission: { id: "sub_1", status: "Pending" },
    design_id: "design_1",
    amount: 1000,
    quantity: 1,
    run_provenance: "recorded",
    production_run_ids: ["run_1"],
    ...over,
  })

  const claimOf = (over: Record<string, any> = {}) => ({
    submission_id: "sub_1",
    status: "Pending",
    quantity: 4,
    claimed_quantity: 4,
    claimed_wholly: false,
    ...over,
  })

  it("reports what is left of a partly claimed run", () => {
    expect(runBillableRemaining({ claim: claimOf(), ordered: 9 })).toBe(5)
    expect(
      runBillingStatus({
        billed: claimOf(),
        unrecordedClaims: [],
        remaining: 5,
      })
    ).toBe("partly_billed")
  })

  it("is `billed` once the ordered quantity is fully claimed", () => {
    const claim = claimOf({ claimed_quantity: 9 })
    expect(runBillableRemaining({ claim, ordered: 9 })).toBe(0)
    expect(
      runBillingStatus({ billed: claim, unrecordedClaims: [], remaining: 0 })
    ).toBe("billed")
  })

  it("says NOTHING rather than 0 when the arithmetic is unavailable", () => {
    // Null, never a number, in exactly the three cases `assessRunClaims`
    // refuses — a number here is a promise the write guard has to keep.
    expect(runBillableRemaining({ claim: null, ordered: 9 })).toBeNull()
    expect(
      runBillableRemaining({ claim: claimOf({ claimed_wholly: true }), ordered: 9 })
    ).toBeNull()
    expect(runBillableRemaining({ claim: claimOf(), ordered: null })).toBeNull()
    expect(runBillableRemaining({ claim: claimOf(), ordered: 0 })).toBeNull()
  })

  it("a run claimed WHOLLY still reads as billed, not partly billed", () => {
    const claim = claimOf({ claimed_wholly: true, claimed_quantity: 0 })
    expect(
      runBillingStatus({
        billed: claim,
        unrecordedClaims: [],
        remaining: runBillableRemaining({ claim, ordered: 9 }),
      })
    ).toBe("billed")
  })

  it("sums every live line naming the run, not just the first", () => {
    const { billedRuns } = foldPartnerBilling([
      line({ quantity: 1 }),
      line({ quantity: 3, submission: { id: "sub_2", status: "Approved" } }),
    ])

    const claim = billedRuns.get("run_1")!
    // The DISPLAYED claim is still the earliest one, as before…
    expect(claim.submission_id).toBe("sub_1")
    // …but the units are everyone's.
    expect(claim.claimed_quantity).toBe(4)
    expect(runBillableRemaining({ claim, ordered: 9 })).toBe(5)
  })

  it("a line over several runs takes each of them whole", () => {
    const { billedRuns } = foldPartnerBilling([
      line({ quantity: 7, production_run_ids: ["run_1", "run_2"] }),
    ])

    expect(billedRuns.get("run_1")?.claimed_wholly).toBe(true)
    expect(
      runBillableRemaining({ claim: billedRuns.get("run_1"), ordered: 9 })
    ).toBeNull()
  })
})

/**
 * #1676 — a run with NO agreed quantity has no ceiling, so its remainder is
 * `null`. Everywhere else `null` means "no arithmetic available", which reads
 * as nothing left — so without the flag, an open-ended run reports `billed`
 * after ONE claim and no screen offers it again. The feature is repeated
 * billing; that would be the feature, undone.
 */
describe("runBillingStatus — an open-ended run (#1676)", () => {
  const claim = {
    submission_id: "sub_1",
    status: "Pending",
    quantity: 4,
    claimed_quantity: 4,
    claimed_wholly: false,
  }

  it("stays partly_billed however much has been claimed", () => {
    expect(
      runBillingStatus({
        billed: claim,
        unrecordedClaims: [],
        remaining: null,
        openEnded: true,
      })
    ).toBe("partly_billed")
  })

  it("is billed without the flag — the null remainder reads as nothing left", () => {
    // The exact failure the flag exists to prevent, pinned so nobody "tidies"
    // the parameter away.
    expect(
      runBillingStatus({
        billed: claim,
        unrecordedClaims: [],
        remaining: null,
      })
    ).toBe("billed")
  })

  it("does not invent a claim where there is none", () => {
    // Open-ended says nothing about whether anybody has billed it yet.
    expect(
      runBillingStatus({ billed: null, unrecordedClaims: [], openEnded: true })
    ).toBe("clear")
  })

  it("still reports a claimless open-ended run's remainder as unknown", () => {
    expect(runBillableRemaining({ claim: null, ordered: null })).toBeNull()
  })
})
