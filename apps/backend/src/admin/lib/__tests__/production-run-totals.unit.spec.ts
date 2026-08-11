import {
  isFulfillmentProvenanceRun,
  leafProductionRuns,
  summarizeProductionRunTotals,
  type ProductionRunLike,
} from "../production-run-totals"

describe("summarizeProductionRunTotals (#498 double-count)", () => {
  it("does NOT double-count a parent against its children", () => {
    const runs: ProductionRunLike[] = [
      { id: "parent", parent_run_id: null, status: "completed", quantity: 10 },
      { id: "c1", parent_run_id: "parent", status: "completed", quantity: 4 },
      { id: "c2", parent_run_id: "parent", status: "completed", quantity: 6 },
    ]
    // Naive sum would be 20; leaf-only sum is 4 + 6 = 10.
    expect(summarizeProductionRunTotals(runs).completed).toBe(10)
  })

  it("counts a simple run with no children exactly once", () => {
    const runs: ProductionRunLike[] = [
      { id: "solo", parent_run_id: null, status: "completed", quantity: 7 },
    ]
    const totals = summarizeProductionRunTotals(runs)
    expect(totals.completed).toBe(7)
    expect(totals.leafCount).toBe(1)
  })

  it("splits completed vs in-progress by leaf status, not the parent's", () => {
    const runs: ProductionRunLike[] = [
      // parent is 'completed' but its children carry the real per-leaf status
      { id: "p", parent_run_id: null, status: "completed", quantity: 10 },
      { id: "c1", parent_run_id: "p", status: "completed", quantity: 4 },
      { id: "c2", parent_run_id: "p", status: "in_progress", quantity: 6 },
    ]
    const totals = summarizeProductionRunTotals(runs)
    expect(totals.completed).toBe(4)
    expect(totals.inProgress).toBe(6)
  })

  it("recognises all in-progress-family statuses", () => {
    const runs: ProductionRunLike[] = [
      { id: "a", status: "in_progress", quantity: 1 },
      { id: "b", status: "sent_to_partner", quantity: 2 },
      { id: "c", status: "approved", quantity: 3 },
      { id: "d", status: "completed", quantity: 4 },
    ]
    const totals = summarizeProductionRunTotals(runs)
    expect(totals.inProgress).toBe(6)
    expect(totals.completed).toBe(4)
  })

  it("handles missing/zero quantities and unknown statuses safely", () => {
    const runs: ProductionRunLike[] = [
      { id: "a", status: "completed" }, // no quantity
      { id: "b", status: "draft", quantity: 5 }, // unknown status
      { id: "c", status: "completed", quantity: 0 },
    ]
    const totals = summarizeProductionRunTotals(runs)
    expect(totals.completed).toBe(0)
    expect(totals.inProgress).toBe(0)
  })

  it("is depth-agnostic (a child that is itself a parent is not a leaf)", () => {
    const runs: ProductionRunLike[] = [
      { id: "p", parent_run_id: null, status: "completed", quantity: 10 },
      { id: "mid", parent_run_id: "p", status: "completed", quantity: 10 },
      { id: "leaf1", parent_run_id: "mid", status: "completed", quantity: 4 },
      { id: "leaf2", parent_run_id: "mid", status: "completed", quantity: 6 },
    ]
    expect(summarizeProductionRunTotals(runs).completed).toBe(10)
    expect(leafProductionRuns(runs).map((r) => r.id)).toEqual(["leaf1", "leaf2"])
  })

  it("tolerates empty / non-array input", () => {
    expect(summarizeProductionRunTotals([])).toEqual({
      completed: 0,
      inProgress: 0,
      leafCount: 0,
      total: 0,
      shippedFromStock: 0,
    })
    // @ts-expect-error - guarding runtime misuse
    expect(summarizeProductionRunTotals(undefined).completed).toBe(0)
  })

  it("reports total run records (parents + children) distinct from leafCount", () => {
    const runs: ProductionRunLike[] = [
      { id: "p", parent_run_id: null, status: "completed", quantity: 10 },
      { id: "c1", parent_run_id: "p", status: "completed", quantity: 4 },
      { id: "c2", parent_run_id: "p", status: "completed", quantity: 6 },
    ]
    const totals = summarizeProductionRunTotals(runs)
    expect(totals.total).toBe(3)
    expect(totals.leafCount).toBe(2)
  })
})

describe("provenance runs are not production", () => {
  const PROVENANCE = { source: "order.fulfillment_created" }

  // The real prod shape: design 01KWWJ0S3Z… "Denim Trouser". Run A is shop-floor
  // work (2 pieces, full lifecycle). Run B was minted when a retail line item
  // shipped FROM STOCK — completed, quantity 1, no partner, no lifecycle, no
  // activities. Both are leaves, so the pre-fix sum reported 3 produced.
  const denimTrouser: ProductionRunLike[] = [
    {
      id: "prod_run_A",
      parent_run_id: null,
      status: "completed",
      quantity: 2,
      metadata: { source: "designs-produce-no-customer" },
    },
    {
      id: "prod_run_B",
      parent_run_id: null,
      status: "completed",
      quantity: 1,
      metadata: { ...PROVENANCE, design_backed: true, is_custom_design: true },
    },
  ]

  it("excludes fulfillment-provenance runs from produced quantity", () => {
    const totals = summarizeProductionRunTotals(denimTrouser)
    expect(totals.completed).toBe(2)
    expect(totals.leafCount).toBe(1)
  })

  it("reports the shipped-from-stock quantity instead of dropping it", () => {
    const totals = summarizeProductionRunTotals(denimTrouser)
    expect(totals.shippedFromStock).toBe(1)
    // Every record is still accounted for.
    expect(totals.total).toBe(2)
  })

  it("catches DESIGN-BACKED provenance runs, which isOwnedProvenanceRun misses", () => {
    // isOwnedProvenanceRun additionally requires design_id == null, so it
    // returns false for run B. The create-side marker is the reliable signal.
    expect(isFulfillmentProvenanceRun(denimTrouser[1])).toBe(true)
    expect(isFulfillmentProvenanceRun(denimTrouser[0])).toBe(false)
  })

  it("does not treat a missing/!=marker metadata as provenance", () => {
    expect(isFulfillmentProvenanceRun({ id: "x" })).toBe(false)
    expect(isFulfillmentProvenanceRun({ id: "x", metadata: null })).toBe(false)
    expect(
      isFulfillmentProvenanceRun({ id: "x", metadata: { source: "order.placed" } })
    ).toBe(false)
  })

  it("excludes provenance runs from in-progress too", () => {
    const runs: ProductionRunLike[] = [
      { id: "real", parent_run_id: null, status: "in_progress", quantity: 5 },
      {
        id: "prov",
        parent_run_id: null,
        status: "in_progress",
        quantity: 3,
        metadata: PROVENANCE,
      },
    ]
    expect(summarizeProductionRunTotals(runs).inProgress).toBe(5)
  })

  it("still detects leaves using the full set when a parent is provenance", () => {
    // A provenance parent must not promote its children out of existence, nor
    // be counted itself.
    const runs: ProductionRunLike[] = [
      { id: "p", parent_run_id: null, status: "completed", quantity: 10, metadata: PROVENANCE },
      { id: "c1", parent_run_id: "p", status: "completed", quantity: 4 },
      { id: "c2", parent_run_id: "p", status: "completed", quantity: 6 },
    ]
    const totals = summarizeProductionRunTotals(runs)
    expect(totals.completed).toBe(10)
    expect(totals.shippedFromStock).toBe(0)
  })
})
