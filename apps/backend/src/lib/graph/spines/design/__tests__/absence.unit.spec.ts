import {
  daysWaiting,
  expectsInventory,
  expectsPartner,
  expectsProductionRun,
  runsAwaitingProduct,
  productNodeState,
  type RunLike,
  expectsSpecification,
  expectsConsumptionLog,
} from "../absence"

const run = (over: Partial<RunLike> = {}): RunLike => ({
  id: over.id ?? "pr_1",
  status: "completed",
  approval_decision: null,
  approved_product_id: null,
  execution_mode: "in_house",
  ...over,
})

describe("runsAwaitingProduct — the motivating absent edge", () => {
  it("counts a completed run with no product", () => {
    expect(runsAwaitingProduct([run()])).toHaveLength(1)
  })

  it("counts an approved run even when it is not yet 'completed'", () => {
    expect(
      runsAwaitingProduct([
        run({ id: "pr_2", status: "in_progress", approval_decision: "approved" }),
      ])
    ).toHaveLength(1)
  })

  it("does NOT count a run that already produced a product", () => {
    expect(
      runsAwaitingProduct([run({ approved_product_id: "prod_01" })])
    ).toHaveLength(0)
  })

  it("does NOT count a cancelled run — abandoned work owes no product", () => {
    expect(runsAwaitingProduct([run({ status: "cancelled" })])).toHaveLength(0)
  })

  it("does NOT count a run still in progress and unapproved", () => {
    expect(runsAwaitingProduct([run({ status: "in_progress" })])).toHaveLength(0)
  })

  it("counts a run once when it is both finished and approved", () => {
    expect(
      runsAwaitingProduct([
        run({ status: "completed", approval_decision: "approved" }),
      ])
    ).toHaveLength(1)
  })

  it("is empty for a design with no runs at all", () => {
    expect(runsAwaitingProduct([])).toHaveLength(0)
  })
})

describe("expectsProductionRun", () => {
  it("expects a run once the design is Approved", () => {
    expect(expectsProductionRun("Approved", 0)).toBe(true)
    expect(expectsProductionRun("Commerce_Ready", 0)).toBe(true)
    expect(expectsProductionRun("Sample_Production", 0)).toBe(true)
  })

  it("expects nothing while the design is still being worked out", () => {
    for (const s of ["Conceptual", "In_Development", "Technical_Review", "Revision", "On_Hold"]) {
      expect(expectsProductionRun(s, 0)).toBe(false)
    }
  })

  it("expects nothing once a run exists", () => {
    expect(expectsProductionRun("Approved", 1)).toBe(false)
  })

  it("does not fire on a rejected or superseded design", () => {
    expect(expectsProductionRun("Rejected", 0)).toBe(false)
    expect(expectsProductionRun("Superseded", 0)).toBe(false)
  })
})

describe("expectsPartner", () => {
  it("expects a partner when a run is outsourced and none is linked", () => {
    expect(expectsPartner([run({ execution_mode: "outsourced" })], 0)).toBe(true)
  })

  it("expects NO partner for in-house work — that is not a missing edge", () => {
    expect(expectsPartner([run({ execution_mode: "in_house" })], 0)).toBe(false)
  })

  it("expects nothing once a partner is linked", () => {
    expect(expectsPartner([run({ execution_mode: "outsourced" })], 1)).toBe(false)
  })
})

describe("expectsInventory", () => {
  it("expects inventory once a run exists", () => {
    expect(expectsInventory([run()], 0)).toBe(true)
  })

  it("expects nothing before any run — material is not owed yet", () => {
    expect(expectsInventory([], 0)).toBe(false)
  })

  it("expects nothing once items are linked", () => {
    expect(expectsInventory([run()], 2)).toBe(false)
  })
})

describe("daysWaiting", () => {
  const now = Date.parse("2026-09-10T00:00:00.000Z")

  it("measures from the OLDEST run, not the newest", () => {
    const days = daysWaiting(
      [
        run({ id: "a", updated_at: "2026-09-01T00:00:00.000Z" }),
        run({ id: "b", updated_at: "2026-09-08T00:00:00.000Z" }),
      ],
      now
    )
    expect(days).toBe(9)
  })

  it("falls back to created_at when a run never moved", () => {
    expect(
      daysWaiting(
        [run({ updated_at: null, created_at: "2026-09-05T00:00:00.000Z" })],
        now
      )
    ).toBe(5)
  })

  it("returns null rather than 0 when nothing carries a date", () => {
    expect(daysWaiting([run({ updated_at: null, created_at: null })], now)).toBeNull()
  })

  it("never returns a negative number for a future stamp", () => {
    expect(
      daysWaiting([run({ updated_at: "2026-09-20T00:00:00.000Z" })], now)
    ).toBe(0)
  })
})

describe("productNodeState — the mixed case real data caught", () => {
  it("is absent when a run is outstanding even though a sibling produced one", () => {
    expect(productNodeState(1, 1)).toBe("absent")
  })

  it("is present only when nothing is outstanding", () => {
    expect(productNodeState(2, 0)).toBe("present")
  })

  it("is absent with no products at all and work finished", () => {
    expect(productNodeState(0, 3)).toBe("absent")
  })

  it("draws no node when there is neither a product nor finished work", () => {
    expect(productNodeState(0, 0)).toBe("none")
  })
})


/**
 * #1847 step 2 — the edges wired after the prototype.
 *
 * Same discipline as the rules above: an absent edge is an assertion, so each
 * one is pinned in BOTH directions — it fires where the model genuinely
 * expects the neighbour, and stays quiet everywhere else.
 */
describe("expectsSpecification", () => {
  it("fires on a committed design with no specification", () => {
    expect(expectsSpecification("Approved", 0)).toBe(true)
    expect(expectsSpecification("Commerce_Ready", 0)).toBe(true)
  })

  it("stays quiet once any specification exists", () => {
    expect(expectsSpecification("Approved", 1)).toBe(false)
  })

  // The whole point of COMMITTED_DESIGN_STATUSES: a design still being drawn
  // owes no tech-pack, and dashing that edge would cry wolf on every draft.
  it("stays quiet on a design that is not committed", () => {
    for (const status of ["Conceptual", "In_Development", "Rejected", "Superseded"]) {
      expect(expectsSpecification(status, 0)).toBe(false)
    }
  })
})

describe("expectsConsumptionLog", () => {
  const run = (status: string) => ({ id: `run_${status}`, status })

  it("fires when a finished run recorded no consumption", () => {
    expect(expectsConsumptionLog([run("completed")], 0)).toBe(true)
  })

  it("stays quiet once any consumption was logged", () => {
    expect(expectsConsumptionLog([run("completed")], 1)).toBe(false)
  })

  // A live run has not drawn its material yet. This is the rule most likely to
  // cry wolf if written as "any run", so it is pinned explicitly.
  it("stays quiet while the work is still in flight", () => {
    for (const status of ["in_progress", "pending", "awaiting_reassignment", "cancelled"]) {
      expect(expectsConsumptionLog([run(status)], 0)).toBe(false)
    }
  })

  it("fires when any one of several runs has finished", () => {
    expect(expectsConsumptionLog([run("in_progress"), run("completed")], 0)).toBe(true)
  })
})

describe("productNodeState — the direct catalogue link", () => {
  // `product_design` joins a design to a product without any run writing
  // `approved_product_id`. Real: two such rows exist locally.
  it("reports derived when only the direct link exists", () => {
    expect(productNodeState(0, 0, 1)).toBe("derived")
  })

  it("still reports none when there is no product by any path", () => {
    expect(productNodeState(0, 0, 0)).toBe("none")
  })

  // 🔴 The ordering that matters: a finished run owes its OWN product, so a
  // design linked to some other product must not discharge it.
  it("keeps absent ahead of derived", () => {
    expect(productNodeState(0, 1, 5)).toBe("absent")
  })

  it("keeps present ahead of derived", () => {
    expect(productNodeState(2, 0, 5)).toBe("present")
  })

  it("is unchanged when no direct link is passed at all", () => {
    expect(productNodeState(0, 1)).toBe("absent")
    expect(productNodeState(1, 0)).toBe("present")
    expect(productNodeState(0, 0)).toBe("none")
  })
})
