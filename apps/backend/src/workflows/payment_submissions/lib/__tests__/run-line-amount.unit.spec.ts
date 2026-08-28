import { resolveRunLineAmount } from "../run-line-amount"

/** The seven runs behind retail order #79, as read from production. */
const ORDER_79_RUNS = [
  "prod_run_01KZ3DA8EMPZPS7024E7S94M4P",
  "prod_run_01KZ3DA8HA2V95V4S41WF8QKK8",
  "prod_run_01KZ3DA8MSF5YDG4R257WY8J2Q",
  "prod_run_01KZ3DA8QC7KEP8RYJBC1H8GJ6",
  "prod_run_01KZ3DA8TV6SR2A90FR1Q1WGWW",
  "prod_run_01KZ3DAA9AB2PQSN5PKE4AEH2R",
  "prod_run_01KZ3DAAFPBRCCZEWCNXRZ524Y",
].map((id) => ({
  id,
  quantity: 1,
  produced_quantity: 1,
  partner_cost_estimate: null,
  cost_type: "total",
}))

describe("resolveRunLineAmount", () => {
  it("bills the order #79 payout as one line claiming all seven runs", () => {
    const line = resolveRunLineAmount({ runs: ORDER_79_RUNS, amount: 8974 })

    expect(line.amount).toBe(8974)
    expect(line.quantity).toBe(7)
    // A typed total carries no rate — 8974/7 = 1282 is a figure nobody agreed to.
    expect(line.unit_amount).toBeNull()
    expect(line.cost_breakdown.run_ids).toHaveLength(7)
    expect(line.cost_breakdown.basis).toBe("explicit_total")
  })

  /**
   * 🔴 The load-bearing test. All seven runs carry `partner_cost_estimate:
   * null`, so derivation yields 0 — and 0 passes every `!= null` check, sums
   * cleanly, and renders as a real payout of nothing (#1563, #1564).
   */
  it("REFUSES to write a zero line when the runs carry no cost", () => {
    expect(() =>
      resolveRunLineAmount({
        runs: ORDER_79_RUNS,
        deriveAmount: () => 0,
      })
    ).toThrow(/must bill a positive amount/)
  })

  it("names the runs in the refusal so an operator knows what to price", () => {
    expect(() =>
      resolveRunLineAmount({ runs: ORDER_79_RUNS, deriveAmount: () => 0 })
    ).toThrow(/prod_run_01KZ3DA8EMPZPS7024E7S94M4P/)
  })

  it("refuses a negative explicit amount", () => {
    expect(() =>
      resolveRunLineAmount({ runs: ORDER_79_RUNS, amount: -100 })
    ).toThrow(/must bill a positive amount/)
  })

  it("refuses a line naming no runs at all", () => {
    expect(() => resolveRunLineAmount({ runs: [], amount: 100 })).toThrow(
      /at least one production run/
    )
  })

  it("derives from the runs when they do carry a cost", () => {
    const line = resolveRunLineAmount({
      runs: [
        { id: "run_a", quantity: 1, produced_quantity: 1, partner_cost_estimate: 810 },
        { id: "run_b", quantity: 1, produced_quantity: 1, partner_cost_estimate: 1110 },
      ],
      deriveAmount: (run) => Number(run.partner_cost_estimate ?? 0),
    })

    expect(line.amount).toBe(1920)
    expect(line.quantity).toBe(2)
    expect(line.unit_amount).toBe(960)
    expect(line.cost_breakdown.basis).toBe("derived_from_runs")
  })

  /**
   * The embroidered-jacket case: ordered 9, produced 7. Billing the ordered
   * figure overpays by two garments — `runPayableAmount` multiplies by ordered,
   * which is exactly the disagreement #1596 is about.
   */
  it("counts PRODUCED quantity, not ordered", () => {
    const line = resolveRunLineAmount({
      runs: [{ id: "run_a", quantity: 9, produced_quantity: 7 }],
      amount: 10000,
    })

    expect(line.quantity).toBe(7)
  })

  it("falls back to ordered quantity when produced was never recorded", () => {
    const line = resolveRunLineAmount({
      runs: [{ id: "run_a", quantity: 4, produced_quantity: null }],
      amount: 400,
    })

    expect(line.quantity).toBe(4)
  })

  it("treats a produced quantity of 0 as 0, not as unrecorded", () => {
    // A run that produced nothing is not a run that forgot to say.
    const line = resolveRunLineAmount({
      runs: [
        { id: "run_a", quantity: 5, produced_quantity: 0 },
        { id: "run_b", quantity: 5, produced_quantity: 3 },
      ],
      amount: 300,
    })

    expect(line.quantity).toBe(3)
  })

  it("lets an explicit quantity override the derived one", () => {
    const line = resolveRunLineAmount({
      runs: [{ id: "run_a", quantity: 9, produced_quantity: 7 }],
      amount: 10000,
      quantity: 9,
    })

    expect(line.quantity).toBe(9)
  })

  it("never lets quantity fall to 0 and produce a divide-by-zero rate", () => {
    const line = resolveRunLineAmount({
      runs: [{ id: "run_a", quantity: 0, produced_quantity: 0 }],
      amount: 500,
    })

    expect(line.quantity).toBe(1)
    expect(Number.isFinite(line.amount)).toBe(true)
  })

  it("rounds an explicit amount to paise", () => {
    const line = resolveRunLineAmount({
      runs: ORDER_79_RUNS,
      amount: 8973.567,
    })

    expect(line.amount).toBe(8973.57)
  })
})
