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
    quantity_basis: "total",
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
          quantity_basis: "total",
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
          quantity_basis: "total",
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
          quantity_basis: "total",
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

/**
 * #1559. The prod row that exposed it: design "Embroidered jacket", one log of
 * `quantity 2.5, quantity_basis per_piece`, against 4 finished pieces. Summing
 * the raw column compared an expected TOTAL of 10 against a RATE of 2.5 and
 * reported a 7.5 m shortfall that does not exist — an instruction to "correct"
 * a log that is already right.
 */
describe("reconcileDesigns — quantity_basis (#1559)", () => {
  const JACKET = "01KWKHSQ8FDGSKNW4FNY3K5FF0"
  const jacketRuns: ReconcileRun[] = [
    { id: "run_jacket", design_id: JACKET, status: "completed", produced_quantity: 4 },
  ]
  const perPieceLog = (over: Partial<ReconcileLog> = {}): ReconcileLog => ({
    id: "l1",
    design_id: JACKET,
    inventory_item_id: "iitem_j",
    quantity: 2.5,
    quantity_basis: "per_piece",
    is_committed: true,
    ...over,
  })

  it("multiplies a per_piece rate by the pieces produced", () => {
    const [r] = reconcileDesigns({
      runs: jacketRuns,
      logs: [perPieceLog()],
      ratePerUnit: { [JACKET]: 2.5 },
    })
    // 2.5/pc x 4 pcs = 10, which is exactly the expected figure.
    expect(r.consumed).toBe(10)
    expect(r.expected).toBe(10)
    expect(r.variance).toBe(0)
    // The whole point: the old code reported this design as short by 7.5.
    expect(r.flags).not.toContain("under_expected")
    expect(r.implied_rate).toBe(2.5)
  })

  it("takes a `total` log at its word — no multiplication", () => {
    const [r] = reconcileDesigns({
      runs: jacketRuns,
      logs: [perPieceLog({ quantity_basis: "total" })],
      ratePerUnit: { [JACKET]: 2.5 },
    })
    expect(r.consumed).toBe(2.5)
    expect(r.flags).toContain("under_expected")
  })

  it("multiplies by the log's OWN run, not everything the design made", () => {
    const [r] = reconcileDesigns({
      runs: [
        ...jacketRuns,
        { id: "run_other", design_id: JACKET, status: "completed", produced_quantity: 6 },
      ],
      logs: [perPieceLog({ production_run_id: "run_jacket" })],
    })
    // 2.5 x 4 (its run), not 2.5 x 10 (the design's whole output).
    expect(r.produced).toBe(10)
    expect(r.consumed).toBe(10)
  })

  it("does NOT guess a null basis — it reports the design as unreadable", () => {
    const [r] = reconcileDesigns({
      runs: jacketRuns,
      logs: [perPieceLog({ quantity_basis: null })],
      ratePerUnit: { [JACKET]: 2.5 },
    })
    expect(r.unresolved_logs).toBe(1)
    expect(r.unresolved_quantity).toBe(2.5)
    // Absent from consumed: it is not known to be 2.5 or 10.
    expect(r.consumed).toBe(0)
    expect(r.flags).toContain("unknown_basis")
    // Withheld — every one of these compares against a total we do not have.
    expect(r.flags).not.toContain("under_expected")
    expect(r.flags).not.toContain("produced_without_consumption")
    expect(r.flags).not.toContain("implausible_rate")
  })

  it("resolves a null basis only when the operator supplies one", () => {
    const [r] = reconcileDesigns({
      runs: jacketRuns,
      logs: [perPieceLog({ quantity_basis: null })],
      assumeBasisWhenUnknown: "per_piece",
    })
    expect(r.unresolved_logs).toBe(0)
    expect(r.consumed).toBe(10)
    expect(r.flags).not.toContain("unknown_basis")
  })

  it("cannot resolve a per_piece rate with nothing produced to multiply by", () => {
    const [r] = reconcileDesigns({
      runs: [],
      logs: [perPieceLog()],
    })
    // The design still surfaces — a log that cannot be read must not vanish.
    expect(r.design_id).toBe(JACKET)
    expect(r.unresolved_logs).toBe(1)
    expect(r.consumed).toBe(0)
    expect(r.flags).toContain("unknown_basis")
  })

  it("still reports a per-piece log with no run attribution", () => {
    const [r] = reconcileDesigns({ runs: jacketRuns, logs: [perPieceLog()] })
    expect(r.unattributed_logs).toBe(1)
    expect(r.flags).toContain("unattributed_consumption")
  })

  it("one unreadable log withholds the verdict for the whole design", () => {
    const [r] = reconcileDesigns({
      runs: jacketRuns,
      logs: [
        perPieceLog({ id: "l1", quantity_basis: "total", quantity: 9 }),
        perPieceLog({ id: "l2", quantity_basis: null, quantity: 1 }),
      ],
      ratePerUnit: { [JACKET]: 2.5 },
    })
    // consumed is a FLOOR here (9 of an unknown total), so `under_expected`
    // against an expected 10 would be an assertion we cannot make.
    expect(r.consumed).toBe(9)
    expect(r.unresolved_logs).toBe(1)
    expect(r.flags).toEqual(
      expect.arrayContaining(["unknown_basis", "unattributed_consumption"])
    )
    expect(r.flags).not.toContain("under_expected")
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
