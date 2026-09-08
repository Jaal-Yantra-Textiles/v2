import {
  runsAwaitingOutputReview,
  shouldExcludeChildRuns,
} from "../run-review"

describe("child runs are reachable in the review queue (#1898)", () => {
  it("INCLUDES children when the review queue is asked for", () => {
    // The defect: 28 of 70 completed runs on prod were children, and the page
    // hid them unconditionally, so the queue could never reach zero.
    expect(shouldExcludeChildRuns({ reviewFilter: "none" })).toBe(false)
  })

  it("stays parents-only for every other view, as before", () => {
    expect(shouldExcludeChildRuns({})).toBe(true)
    expect(shouldExcludeChildRuns({ reviewFilter: "approved" })).toBe(true)
    expect(shouldExcludeChildRuns({ reviewFilter: "rejected" })).toBe(true)
  })

  it("lets an explicit Scope choice win over the review filter, both ways", () => {
    expect(shouldExcludeChildRuns({ scopeFilter: "all" })).toBe(false)
    expect(
      shouldExcludeChildRuns({ scopeFilter: "parents", reviewFilter: "none" })
    ).toBe(true)
    expect(
      shouldExcludeChildRuns({ scopeFilter: "all", reviewFilter: "approved" })
    ).toBe(false)
  })
})

describe("which runs await output review (#1898)", () => {
  // The real pair from design 01KKP0RHEW57DSCSRSQQW0SAN2 — one parent, one
  // child, both completed 2026-07-25, both undecided since.
  const JACKET_RUNS = [
    { id: "prod_run_01KW74KBC1XZ5724G1XWY73XZK", status: "completed", parent_run_id: null, approval_decision: null },
    { id: "prod_run_01KW74KC1J431DBMG5MCG0Q43K", status: "completed", parent_run_id: "prod_run_01KW74KBC1XZ5724G1XWY73XZK", approval_decision: null },
  ]

  it("finds both runs on the design whose page offered no way to review them", () => {
    expect(runsAwaitingOutputReview(JACKET_RUNS).map((r) => r.id)).toEqual([
      "prod_run_01KW74KBC1XZ5724G1XWY73XZK",
      "prod_run_01KW74KC1J431DBMG5MCG0Q43K",
    ])
  })

  it("does NOT re-offer a run that was already decided", () => {
    // A rejected run stays `completed` (#1805), so status alone cannot tell
    // "decided" from "nobody has looked".
    const decided = [
      { status: "completed", approval_decision: "rejected" },
      { status: "completed", approval_decision: "approved" },
    ]
    expect(runsAwaitingOutputReview(decided)).toHaveLength(0)
  })

  it("ignores runs that are not completed", () => {
    const open = [
      { status: "in_progress", approval_decision: null },
      { status: "cancelled", approval_decision: null },
    ]
    expect(runsAwaitingOutputReview(open)).toHaveLength(0)
  })

  it("treats undefined like null, and survives no runs at all", () => {
    expect(runsAwaitingOutputReview([{ status: "completed" }])).toHaveLength(1)
    expect(runsAwaitingOutputReview(null)).toHaveLength(0)
    expect(runsAwaitingOutputReview(undefined)).toHaveLength(0)
  })
})
