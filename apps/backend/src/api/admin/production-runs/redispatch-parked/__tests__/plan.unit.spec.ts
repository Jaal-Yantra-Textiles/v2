import { planRedispatch, type ParkedRun } from "../plan"

/**
 * The safety property this exists for: a parked run goes back to the partner it
 * came from, never to the partner named in the request. Dispatch notifies the
 * partner, so mis-routing is not fixable by editing a row afterwards.
 */
describe("planRedispatch", () => {
  const run = (id: string, previous: string | null): ParkedRun => ({
    id,
    previous_partner_id: previous,
  })

  it("sends each run back to its own previous partner", () => {
    const plan = planRedispatch([run("r1", "part_a"), run("r2", "part_b")])

    expect(plan.selected).toEqual([
      { run: expect.objectContaining({ id: "r1" }), partner_id: "part_a" },
      { run: expect.objectContaining({ id: "r2" }), partner_id: "part_b" },
    ])
  })

  it("treats partner_id as a FILTER, never as the assignee", () => {
    const plan = planRedispatch([run("r1", "part_a"), run("r2", "part_b")], {
      partnerId: "part_a",
    })

    expect(plan.selected).toHaveLength(1)
    expect(plan.selected[0].run.id).toBe("r1")
    // The whole point: r1 goes to part_a because that is where it came from.
    expect(plan.selected[0].partner_id).toBe("part_a")
  })

  it("never routes another partner's run to the filtered partner", () => {
    const plan = planRedispatch([run("r2", "part_b")], { partnerId: "part_a" })

    expect(plan.selected).toEqual([])
  })

  it("sets aside runs with no previous partner rather than inventing one", () => {
    const plan = planRedispatch([run("r1", "part_a"), run("r2", null)])

    expect(plan.selected.map((s) => s.run.id)).toEqual(["r1"])
    expect(plan.orphaned.map((r) => r.id)).toEqual(["r2"])
  })

  it("reports what a limit cut instead of dropping it silently", () => {
    const plan = planRedispatch(
      [run("r1", "part_a"), run("r2", "part_a"), run("r3", "part_a")],
      { limit: 2 }
    )

    expect(plan.selected.map((s) => s.run.id)).toEqual(["r1", "r2"])
    expect(plan.deferred.map((r) => r.id)).toEqual(["r3"])
  })

  it("handles an empty queue", () => {
    expect(planRedispatch([])).toEqual({
      selected: [],
      orphaned: [],
      deferred: [],
    })
  })
})
