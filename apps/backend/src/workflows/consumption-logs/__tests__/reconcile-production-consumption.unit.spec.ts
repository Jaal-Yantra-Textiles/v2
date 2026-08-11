import {
  isProvenanceRun,
  leafRuns,
  reconcileDesigns,
  type ReconcileLog,
  type ReconcileRun,
} from "../lib/reconcile-production-consumption"

const DENIM = "01KWWJ0S3ZWWNK6YTDSC2AFARQ"

/** The real prod shape for design "Denim Trouser". */
const denimRuns: ReconcileRun[] = [
  {
    id: "prod_run_A",
    design_id: DENIM,
    parent_run_id: null,
    status: "completed",
    produced_quantity: 2,
    quantity: 2,
    metadata: { source: "designs-produce-no-customer" },
  },
  {
    id: "prod_run_B",
    design_id: DENIM,
    parent_run_id: null,
    status: "completed",
    produced_quantity: 1,
    quantity: 1,
    metadata: { source: "order.fulfillment_created", design_backed: true },
  },
]

const denimLogs: ReconcileLog[] = [
  {
    id: "log_1",
    design_id: DENIM,
    inventory_item_id: "iitem_01KMEYT9C8JSK12TK7ZY0G3WXT",
    production_run_id: null,
    quantity: 2.15,
    is_committed: true,
  },
]

describe("reconcileDesigns", () => {
  it("counts real production only — a provenance run consumed nothing", () => {
    const [r] = reconcileDesigns({ runs: denimRuns, logs: denimLogs })
    expect(r.produced).toBe(2)
    expect(r.shipped_from_stock).toBe(1)
    // The bug this guards: summing produced_quantity across both runs gives 3,
    // which would invent a piece's worth of expected fabric out of a stock sale.
    expect(r.implied_rate).toBe(1.075)
  })

  it("computes expected and variance against a known per-unit rate", () => {
    const [r] = reconcileDesigns({
      runs: denimRuns,
      logs: denimLogs,
      ratePerUnit: { [DENIM]: 2.5 },
    })
    expect(r.expected).toBe(5) // 2.5 x 2 real pieces, NOT x 3
    expect(r.variance).toBe(2.85)
    expect(r.flags).toContain("under_expected")
  })

  it("flags a log that is not attributed to any production run", () => {
    const [r] = reconcileDesigns({ runs: denimRuns, logs: denimLogs })
    expect(r.unattributed_logs).toBe(1)
    expect(r.flags).toContain("unattributed_consumption")
  })

  it("flags production with no material logged at all", () => {
    // Five prod designs look like this — the largest failure mode by count.
    const [r] = reconcileDesigns({
      runs: [
        { id: "r1", design_id: "d_jacket", status: "completed", produced_quantity: 3 },
      ],
      logs: [],
    })
    expect(r.produced).toBe(3)
    expect(r.consumed).toBe(0)
    expect(r.implied_rate).toBeNull()
    expect(r.flags).toContain("produced_without_consumption")
  })

  it("flags an implausible per-piece rate", () => {
    // "Bakshi's Design" on prod: 9 pieces, 1.75 m logged = 0.19 m/piece.
    const [r] = reconcileDesigns({
      runs: [
        { id: "r1", design_id: "d_bakshi", status: "completed", produced_quantity: 9 },
      ],
      logs: [
        {
          id: "l1",
          design_id: "d_bakshi",
          inventory_item_id: "iitem_x",
          quantity: 1.75,
          is_committed: true,
        },
      ],
    })
    expect(r.implied_rate).toBe(0.194444)
    expect(r.flags).toContain("implausible_rate")
  })

  it("flags consumption recorded against no production run at all", () => {
    const [r] = reconcileDesigns({
      runs: [],
      logs: [
        {
          id: "l1",
          design_id: "d_partner",
          inventory_item_id: "iitem_y",
          quantity: 2.5,
          is_committed: true,
        },
      ],
    })
    expect(r.produced).toBe(0)
    expect(r.consumed).toBe(2.5)
    expect(r.flags).toContain("consumption_without_production")
  })

  it("ignores uncommitted logs and labour/energy logs", () => {
    const [r] = reconcileDesigns({
      runs: [
        { id: "r1", design_id: "d1", status: "completed", produced_quantity: 2 },
      ],
      logs: [
        // labour: no inventory_item_id (1300 such rows on prod)
        { id: "l1", design_id: "d1", quantity: 8, is_committed: true },
        // not committed yet
        {
          id: "l2",
          design_id: "d1",
          inventory_item_id: "iitem_z",
          quantity: 99,
          is_committed: false,
        },
      ],
    })
    expect(r.consumed).toBe(0)
    expect(r.flags).toContain("produced_without_consumption")
  })

  it("does not double-count a parent against its children (#498)", () => {
    const runs: ReconcileRun[] = [
      { id: "p", design_id: "d1", status: "completed", produced_quantity: 10 },
      { id: "c1", design_id: "d1", parent_run_id: "p", status: "completed", produced_quantity: 4 },
      { id: "c2", design_id: "d1", parent_run_id: "p", status: "completed", produced_quantity: 6 },
    ]
    const [r] = reconcileDesigns({ runs, logs: [] })
    expect(r.produced).toBe(10)
  })

  it("ignores runs that are not completed", () => {
    const [r] = reconcileDesigns({
      runs: [
        { id: "r1", design_id: "d1", status: "in_progress", produced_quantity: 5 },
        { id: "r2", design_id: "d1", status: "completed", produced_quantity: 2 },
      ],
      logs: [],
    })
    expect(r.produced).toBe(2)
  })

  it("falls back to ordered quantity when yield was never recorded", () => {
    const [r] = reconcileDesigns({
      runs: [
        { id: "r1", design_id: "d1", status: "completed", produced_quantity: null, quantity: 4 },
      ],
      logs: [],
    })
    expect(r.produced).toBe(4)
  })

  it("sorts worst-first by produced quantity", () => {
    const out = reconcileDesigns({
      runs: [
        { id: "r1", design_id: "small", status: "completed", produced_quantity: 1 },
        { id: "r2", design_id: "big", status: "completed", produced_quantity: 9 },
      ],
      logs: [],
    })
    expect(out.map((r) => r.design_id)).toEqual(["big", "small"])
  })
})

describe("isProvenanceRun / leafRuns", () => {
  it("matches design-backed provenance, not real work", () => {
    expect(isProvenanceRun(denimRuns[1])).toBe(true)
    expect(isProvenanceRun(denimRuns[0])).toBe(false)
    expect(isProvenanceRun({ id: "x" })).toBe(false)
  })

  it("drops runs that are referenced as a parent", () => {
    const runs: ReconcileRun[] = [
      { id: "p" },
      { id: "c", parent_run_id: "p" },
    ]
    expect(leafRuns(runs).map((r) => r.id)).toEqual(["c"])
  })
})
