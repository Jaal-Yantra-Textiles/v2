import {
  daysWaiting,
  expectsInventory,
  expectsPartner,
  expectsProductionRun,
  runsAwaitingProduct,
  type RunLike,
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
