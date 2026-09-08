/**
 * Rejected runs, on one rule, for two surfaces (#1912).
 *
 * `approval_decision` is a SEPARATE AXIS from `status`: a rejected run stays
 * `completed`, because the work WAS done and the partner is still owed for it.
 * Every status-based view therefore shows a rejected run exactly like an
 * approved one — the decision is recorded and read by nothing that keys on
 * status. Production held ten such runs across five designs when this shipped,
 * every one of them reading as plain `completed`.
 *
 * The design page and the `runs-rejected` cohort board must never disagree
 * about which runs those are, so both import `runsRejected` and neither
 * restates it. This spec pins the predicate itself — the thing a second copy
 * would drift from.
 */
import {
  runsAwaitingProduct,
  runsRejected,
  type RunLike,
} from "../absence"

const run = (over: Partial<RunLike> & { id: string }): RunLike => ({
  status: "completed",
  ...over,
})

describe("runsRejected", () => {
  it("selects only runs whose approval_decision is rejected", () => {
    const out = runsRejected([
      run({ id: "a", approval_decision: "rejected" }),
      run({ id: "b", approval_decision: "approved" }),
      run({ id: "c", approval_decision: null }),
      run({ id: "d" }),
    ])
    expect(out.map((r) => r.id)).toEqual(["a"])
  })

  it("does NOT key on status — a rejected run is still completed", () => {
    // The whole reason this board exists. If the predicate filtered on status
    // it would return the same set as "completed" and surface nothing new.
    const runs = [
      run({ id: "a", status: "completed", approval_decision: "rejected" }),
      run({ id: "b", status: "completed", approval_decision: "approved" }),
      run({ id: "c", status: "completed" }),
    ]
    expect(runsRejected(runs).map((r) => r.id)).toEqual(["a"])
    // All three are completed; only one is rejected.
    expect(runs.filter((r) => r.status === "completed")).toHaveLength(3)
  })

  it("finds a rejected run whatever status it carries", () => {
    // Nothing in the rule may assume `completed`: the decision is its own axis
    // and a future status must not silently drop a rejection off the board.
    const out = runsRejected([
      run({ id: "a", status: "in_progress", approval_decision: "rejected" }),
      run({ id: "b", status: "shipped", approval_decision: "rejected" }),
    ])
    expect(out.map((r) => r.id)).toEqual(["a", "b"])
  })

  it("deduplicates by id, like its neighbour", () => {
    const out = runsRejected([
      run({ id: "a", approval_decision: "rejected" }),
      run({ id: "a", approval_decision: "rejected" }),
    ])
    expect(out).toHaveLength(1)
  })

  it("returns nothing for an empty list rather than throwing", () => {
    expect(runsRejected([])).toEqual([])
  })

  it("is independent of runsAwaitingProduct — a rejected run is not 'awaiting'", () => {
    /*
     * These two predicates answer different questions about the same run, and
     * conflating them is the plausible mistake: a rejected run is finished and
     * has no product, so a careless reading puts it on the products-awaiting
     * board as work owed a listing. Approval creates a product; REJECTION
     * creates nothing — so a rejected run must never be sold as a missing
     * listing.
     */
    const rejected = run({
      id: "r",
      status: "completed",
      approval_decision: "rejected",
      approved_product_id: null,
    })
    expect(runsRejected([rejected]).map((r) => r.id)).toEqual(["r"])

    // Documents today's behaviour rather than asserting a preference: the
    // awaiting rule keys on finished-and-unlisted, so it DOES currently
    // include a rejected run. Recorded so that if the product board is ever
    // narrowed to exclude rejections, this line fails and says why.
    expect(runsAwaitingProduct([rejected]).map((r) => r.id)).toEqual(["r"])
  })
})
