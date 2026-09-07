import {
  countChildRuns,
  describeRunKind,
  hydrateRunKind,
  isAggregateRun,
  isStageRun,
} from "../lib/run-kind"
import { assessRunPayout } from "../lib/run-payable"

/**
 * #1877 — `production_runs` holds work, rollups and stages in one table.
 * These are the three readings that were previously left to every caller.
 */
describe("run kind predicates", () => {
  it("calls a plain run work", () => {
    expect(describeRunKind({ id: "r1" })).toBe("work")
    expect(isStageRun({ id: "r1" })).toBe(false)
    expect(isAggregateRun({ id: "r1" })).toBe(false)
  })

  it("calls a run with a parent a stage — real work, not an aggregate", () => {
    const stage = { id: "r2", parent_run_id: "r1", role: "Cutting" }
    expect(describeRunKind(stage)).toBe("stage")
    expect(isStageRun(stage)).toBe(true)
    expect(isAggregateRun(stage)).toBe(false)
  })

  it("calls a run with children a rollup", () => {
    const parent = { id: "r1", child_run_count: 3 }
    expect(describeRunKind(parent)).toBe("rollup")
    expect(isAggregateRun(parent)).toBe(true)
  })

  it("calls a run that is BOTH a child and a parent a rollup — depth-agnostic", () => {
    expect(
      describeRunKind({ id: "r2", parent_run_id: "r1", child_run_count: 2 })
    ).toBe("rollup")
  })

  it("treats an UNASKED child count as not-an-aggregate, never as zero children", () => {
    // undefined means nobody looked. The answer is the pre-#1877 behaviour,
    // not a claim that the run has no children.
    expect(isAggregateRun({ id: "r1" })).toBe(false)
    expect(isAggregateRun({ id: "r1", child_run_count: null })).toBe(false)
    expect(isAggregateRun({ id: "r1", child_run_count: 0 })).toBe(false)
  })

  it("ignores a blank parent_run_id rather than reading '' as a parent", () => {
    expect(isStageRun({ id: "r1", parent_run_id: "" })).toBe(false)
    expect(isStageRun({ id: "r1", parent_run_id: "   " })).toBe(false)
  })
})

describe("countChildRuns / hydrateRunKind", () => {
  const scopeWith = (children: any[], listMock?: jest.Mock) => {
    const list = listMock ?? jest.fn().mockResolvedValue(children)
    return {
      scope: { resolve: jest.fn().mockReturnValue({ listProductionRuns: list }) },
      list,
    }
  }

  it("asks for the runs that name this one as parent", async () => {
    const { scope, list } = scopeWith([{ id: "c1" }, { id: "c2" }])
    expect(await countChildRuns(scope, "r1")).toBe(2)
    expect(list.mock.calls[0][0]).toEqual({ parent_run_id: "r1" })
  })

  it("does not query at all for a missing id", async () => {
    const { scope, list } = scopeWith([])
    expect(await countChildRuns(scope, null)).toBe(0)
    expect(list).not.toHaveBeenCalled()
  })

  it("fills child_run_count in without disturbing the run", async () => {
    const { scope } = scopeWith([{ id: "c1" }])
    const run = { id: "r1", status: "completed", quantity: 9 }
    expect(await hydrateRunKind(scope, run)).toEqual({
      ...run,
      child_run_count: 1,
    })
  })

  it("leaves the count UNASKED when the query fails — a failure is not evidence of zero", async () => {
    const list = jest.fn().mockRejectedValue(new Error("db down"))
    const { scope } = scopeWith([], list)
    const run = { id: "r1" }
    const out: any = await hydrateRunKind(scope, run)
    expect(out.child_run_count).toBeUndefined()
    expect(isAggregateRun(out)).toBe(false)
  })
})

/**
 * The payout half of #1877. A rollup carries the SUMMED quantity of its
 * children, and every child is payable in its own right — so billing the
 * parent pays the partner for the sum AND for each part of it.
 */
describe("assessRunPayout — the rollup guard", () => {
  const parent = {
    id: "run_parent",
    status: "completed",
    design_id: "des_1",
    partner_id: "part_1",
    // The summed quantity of its children — this is what would be billed.
    quantity: 10,
    partner_cost_estimate: 850,
    cost_type: "per_unit" as const,
  }

  it("refuses a completed, fully-priced rollup", () => {
    expect(assessRunPayout({ ...parent, child_run_count: 2 })).toEqual({
      eligible: false,
      reason: "aggregate_run",
    })
  })

  it("still pays each STAGE — a child is real work", () => {
    const stage = {
      ...parent,
      id: "run_child",
      parent_run_id: "run_parent",
      role: "Cutting",
      quantity: 4,
      child_run_count: 0,
    }
    const payout = assessRunPayout(stage)
    expect(payout.eligible).toBe(true)
    expect((payout as any).amount).toBe(3400)
  })

  it("refuses the rollup BEFORE the no-cost check, so the reason survives someone filling the cost in", () => {
    // Today every parent is refused as `no_cost` purely by accident: nothing
    // sets a cost on one. The reason must not depend on that accident.
    expect(
      assessRunPayout({
        ...parent,
        partner_cost_estimate: null,
        child_run_count: 2,
      })
    ).toEqual({ eligible: false, reason: "aggregate_run" })
  })

  it("is unchanged for an ordinary run whose child count was fetched as zero", () => {
    const payout = assessRunPayout({ ...parent, child_run_count: 0 })
    expect(payout.eligible).toBe(true)
    expect((payout as any).amount).toBe(8500)
  })
})
