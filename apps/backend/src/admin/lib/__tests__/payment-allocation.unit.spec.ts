import {
  checkShares,
  payoutRemaining,
  suggestShares,
} from "../payment-allocation"

/** HR Handloom, 2026-11-07. */
const old = { submission_id: "sub_old", remaining: 16380, submitted_at: "2026-09-01" }
const fresh = { submission_id: "sub_new", remaining: 86743, submitted_at: "2026-11-07" }

describe("payment allocation drawer maths (#2523)", () => {
  it("suggests oldest payout first, as the ledger would", () => {
    expect(suggestShares(25000, [fresh, old])).toEqual({ sub_old: 16380, sub_new: 8620 })
  })

  it("leaves later payouts at 0 once the payment runs out", () => {
    expect(suggestShares(10000, [old, fresh])).toEqual({ sub_old: 10000, sub_new: 0 })
  })

  it("reports what a split leaves unallocated", () => {
    expect(checkShares(25000, { sub_old: 0, sub_new: 20000 }, [old, fresh])).toEqual({
      total: 20000,
      left: 5000,
      problems: [],
    })
  })

  it("flags shares above the payment and above a payout's claim", () => {
    const v = checkShares(25000, { sub_old: 20000, sub_new: 10000 }, [old, fresh])
    expect(v.problems).toHaveLength(2)
    expect(v.left).toBe(-5000)
  })

  it("reads a payout's remaining claim net of settled money and credits", () => {
    expect(payoutRemaining({ amount: 17760, settled_amount: 14000, credited_amount: 3760 })).toBe(0)
    expect(payoutRemaining({ amount: 86743, settled_amount: 25000 })).toBe(61743)
  })
})
