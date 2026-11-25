import {
  buildPendingWorkGraph,
  isBalanceOpen,
  isClosedWithoutPrice,
  isDesignOrderAwaitingBuyer,
  isWithPartner,
} from "../pending-work"

const NOW = new Date("2026-11-26T00:00:00Z").getTime()

describe("pending work — the rules", () => {
  it("a run is 'with a partner' only once sent and before it closes", () => {
    expect(isWithPartner({ partner_id: "p", status: "sent_to_partner" })).toBe(true)
    expect(isWithPartner({ partner_id: "p", status: "in_progress" })).toBe(true)
    expect(isWithPartner({ partner_id: "p", status: "approved" })).toBe(false)
    expect(isWithPartner({ partner_id: "p", status: "completed" })).toBe(false)
    // A parent rollup has no partner — it is a heading, not a job.
    expect(isWithPartner({ partner_id: null, status: "in_progress" })).toBe(false)
  })

  it("a closed partner run with no rate, in the last 90 days, needs a price", () => {
    const recent = new Date(NOW - 5 * 864e5).toISOString()
    expect(isClosedWithoutPrice({ partner_id: "p", status: "completed", partner_cost_estimate: null, completed_at: recent }, NOW)).toBe(true)
    // 🔑 0 is not a price either.
    expect(isClosedWithoutPrice({ partner_id: "p", status: "completed", partner_cost_estimate: 0, completed_at: recent }, NOW)).toBe(true)
    expect(isClosedWithoutPrice({ partner_id: "p", status: "completed", partner_cost_estimate: 780, completed_at: recent }, NOW)).toBe(false)
    const old = new Date(NOW - 200 * 864e5).toISOString()
    expect(isClosedWithoutPrice({ partner_id: "p", status: "completed", partner_cost_estimate: null, completed_at: old }, NOW)).toBe(false)
  })

  it("a balance is open once the deposit is paid and until the balance is", () => {
    expect(isBalanceOpen({ order_id: "o", deposit_status: "paid", balance_status: "not_due" })).toBe(true)
    expect(isBalanceOpen({ order_id: "o", deposit_status: "paid", balance_status: "due" })).toBe(true)
    expect(isBalanceOpen({ order_id: "o", deposit_status: "paid", balance_status: "paid" })).toBe(false)
    expect(isBalanceOpen({ order_id: "o", deposit_status: "pending", balance_status: "not_due" })).toBe(false)
    // A cart-stage schedule (no order yet) is a design order, not a balance.
    expect(isBalanceOpen({ order_id: null, deposit_status: "paid", balance_status: "not_due" })).toBe(false)
  })

  it("a design order awaits the buyer until it is paid or cancelled", () => {
    expect(isDesignOrderAwaitingBuyer({ completed_at: null, metadata: {} })).toBe(true)
    expect(isDesignOrderAwaitingBuyer({ completed_at: "2026-11-01", metadata: {} })).toBe(false)
    expect(isDesignOrderAwaitingBuyer({ completed_at: null, metadata: { cancelled_at: "2026-11-25" } })).toBe(false)
  })
})

describe("pending work — the board", () => {
  const bucket = (key: string, side: "us" | "partner" | "customer" = "us") => ({ key, label: key, side, href: null })

  it("draws every box with its count in the sublabel (the canvas hides count when a sublabel is set)", () => {
    const g = buildPendingWorkGraph([
      { bucket: bucket("partners-to-pay"), result: { count: 3, items: [], summary: "INR 12,505 outstanding" } },
      { bucket: bucket("balances-due", "customer"), result: { count: 0, items: [] } },
    ])
    expect(g.nodes.map((n) => n.sublabel)).toEqual(["3 · INR 12,505 outstanding", "0"])
    expect(g.spine.count).toBe(3)
    expect(g.nodes[1].state).toBe("derived")
  })

  it("a box whose reader FAILED says so — it is never drawn as zero", () => {
    const g = buildPendingWorkGraph([
      { bucket: bucket("goods-to-count"), error: "connection reset" },
      { bucket: bucket("runs-with-partner", "partner"), result: { count: 2, items: [] } },
    ])
    const failed = g.nodes.find((n) => n.key === "goods-to-count")!
    expect(failed.status).toBe("error")
    expect(failed.sublabel).toContain("could not be read")
    expect(failed.sublabel).not.toMatch(/^0/)
    expect(g.spine.sublabel).toContain("1 could not be read")
  })
})
