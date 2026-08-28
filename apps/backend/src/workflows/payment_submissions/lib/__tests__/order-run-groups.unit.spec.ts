import { groupOrderBackedRuns, RunClaimInfo } from "../order-run-groups"

/** The seven runs behind retail order #79, as read from production. */
const ORDER_79 = "order_01KXWHFP132AM0H940WFD2P0XW"
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
  order_id: ORDER_79,
  quantity: 1,
  produced_quantity: 1,
  completed_at: "2026-08-03T08:54:44.436Z",
}))

const noClaims = new Map<string, RunClaimInfo>()

describe("groupOrderBackedRuns", () => {
  it("surfaces order #79's seven runs as ONE payable group", () => {
    const groups = groupOrderBackedRuns(ORDER_79_RUNS, noClaims)

    expect(groups).toHaveLength(1)
    expect(groups[0].order_id).toBe(ORDER_79)
    expect(groups[0].run_count).toBe(7)
    expect(groups[0].run_ids).toHaveLength(7)
    expect(groups[0].produced_quantity).toBe(7)
    expect(groups[0].billing_status).toBe("clear")
  })

  /**
   * 🔴 These runs carry `partner_cost_estimate: null`, so any computed figure
   * would be a 0 dressed as a price — and 0 passes every `!= null` check
   * downstream (#1563, #1564).
   */
  it("never offers an amount, and says why", () => {
    const groups = groupOrderBackedRuns(ORDER_79_RUNS, noClaims)

    expect(groups[0].amount).toBeNull()
    expect(groups[0].amount_reason).toMatch(/must be stated by an operator/)
  })

  it("separates runs from different orders", () => {
    const groups = groupOrderBackedRuns(
      [
        { id: "run_a", order_id: "order_1", produced_quantity: 1 },
        { id: "run_b", order_id: "order_2", produced_quantity: 2 },
        { id: "run_c", order_id: "order_1", produced_quantity: 3 },
      ],
      noClaims
    )

    expect(groups).toHaveLength(2)
    expect(groups.find((g) => g.order_id === "order_1")?.run_count).toBe(2)
    expect(groups.find((g) => g.order_id === "order_1")?.produced_quantity).toBe(4)
  })

  it("reports a fully claimed group as billed", () => {
    const claims = new Map(
      ORDER_79_RUNS.map((run) => [
        run.id,
        { submission_id: "sub_1", status: "Paid" },
      ])
    )

    const groups = groupOrderBackedRuns(ORDER_79_RUNS, claims)

    expect(groups[0].billing_status).toBe("billed")
    expect(groups[0].claimed_by).toBe("sub_1")
  })

  /**
   * 🔴 The load-bearing case. Collapsing this into `billed` hides money owed;
   * collapsing it into `clear` invites a double payment on the claimed runs.
   */
  it("reports a partly claimed group as partly_billed, not as either extreme", () => {
    const claims = new Map([
      [ORDER_79_RUNS[0].id, { submission_id: "sub_1", status: "Paid" }],
      [ORDER_79_RUNS[1].id, { submission_id: "sub_1", status: "Paid" }],
    ])

    const groups = groupOrderBackedRuns(ORDER_79_RUNS, claims)

    expect(groups[0].billing_status).toBe("partly_billed")
    expect(groups[0].billing_status).not.toBe("billed")
    expect(groups[0].billing_status).not.toBe("clear")
  })

  it("ignores runs with no order at all", () => {
    const groups = groupOrderBackedRuns(
      [
        { id: "run_a", order_id: null, produced_quantity: 1 },
        { id: "run_b", order_id: ORDER_79, produced_quantity: 1 },
      ],
      noClaims
    )

    expect(groups).toHaveLength(1)
    expect(groups[0].run_ids).toEqual(["run_b"])
  })

  it("falls back to ordered quantity when produced was never recorded", () => {
    const groups = groupOrderBackedRuns(
      [{ id: "run_a", order_id: "o1", quantity: 5, produced_quantity: null }],
      noClaims
    )

    expect(groups[0].produced_quantity).toBe(5)
  })

  it("takes the LATEST completion across the group", () => {
    const groups = groupOrderBackedRuns(
      [
        { id: "a", order_id: "o1", completed_at: "2026-08-01T00:00:00.000Z" },
        { id: "b", order_id: "o1", completed_at: "2026-08-09T00:00:00.000Z" },
        { id: "c", order_id: "o1", completed_at: "2026-08-05T00:00:00.000Z" },
      ],
      noClaims
    )

    expect(groups[0].completed_at).toBe("2026-08-09T00:00:00.000Z")
  })

  it("returns an empty list rather than throwing on no runs", () => {
    expect(groupOrderBackedRuns([], noClaims)).toEqual([])
  })
})
