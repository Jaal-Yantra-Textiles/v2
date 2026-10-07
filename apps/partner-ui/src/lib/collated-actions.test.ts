import { describe, expect, it } from "vitest"

import {
  bulkActions,
  describeBulkFailures,
  draftClaimingRuns,
  preselectRunIds,
  type CollatedRun,
} from "./collated-actions"

const item = (id: string, run: Record<string, unknown>, actionable?: boolean): CollatedRun => ({
  lineId: `line_${id}`,
  run: { id, ...run },
  name: `Design ${id.toUpperCase()}`,
  actionable,
})

describe("bulkActions — #2357, which designs each 'all' action covers", () => {
  const runs = [
    item("a", { status: "sent_to_partner" }),
    item("b", { status: "sent_to_partner" }),
    item("c", { status: "in_progress" }),
    item("d", { status: "in_progress", started_at: "x" }),
    item("e", { status: "in_progress", started_at: "x", finished_at: "y" }),
    item("f", { status: "completed" }),
    item("g", { status: "cancelled" }),
  ]

  it("groups each design under the one step it owes, in lifecycle order", () => {
    expect(
      bulkActions(runs).map((b) => [b.action, b.runs.map((r) => r.run.id)])
    ).toEqual([
      ["accept", ["a", "b"]],
      ["start", ["c"]],
      ["finish", ["d"]],
      ["complete", ["e"]],
    ])
  })

  it("offers nothing for a design whose assignment was cancelled", () => {
    expect(bulkActions([item("a", { status: "sent_to_partner" }, false)])).toEqual([])
  })

  it("offers nothing when every design is done", () => {
    expect(bulkActions([runs[5], runs[6]])).toEqual([])
  })
})

describe("describeBulkFailures — failures are named, with the reason", () => {
  const runs = [item("a", {}), item("b", {}), item("c", {})]

  it("says how many went through and which did not, by name", () => {
    expect(
      describeBulkFailures(runs, ["a", "c"], [{ runId: "b", message: "Run is not sent_to_partner" }])
    ).toBe("2 of 3 went through. Design B: Run is not sent_to_partner")
  })

  it("is silent when all went through", () => {
    expect(describeBulkFailures(runs, ["a", "b", "c"], [])).toBeNull()
  })

  it("says none went through when all failed", () => {
    expect(describeBulkFailures(runs, [], [{ runId: "a", message: "x" }])).toBe(
      "None went through. Design A: x"
    )
  })
})

describe("payment hand-off after completion", () => {
  const subs = [
    { id: "ps_pending", status: "Pending", items: [{ production_run_ids: ["r1"] }] },
    { id: "ps_draft", status: "Draft", items: [{ production_run_ids: ["r2", "r3"] }] },
  ]

  it("opens the Draft that already claims the run, never a Pending one", () => {
    expect(draftClaimingRuns(subs, ["r3"])?.id).toBe("ps_draft")
    expect(draftClaimingRuns(subs, ["r1"])).toBeNull()
    expect(draftClaimingRuns(subs, ["r9"])).toBeNull()
  })

  it("pre-ticks only runs that can be submitted", () => {
    expect(preselectRunIds("r1, r2,r9", ["r1", "r2"])).toEqual(["r1", "r2"])
    expect(preselectRunIds(null, ["r1"])).toEqual([])
  })
})
