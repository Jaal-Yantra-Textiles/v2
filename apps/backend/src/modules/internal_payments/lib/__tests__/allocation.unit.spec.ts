import { checkAllocation } from "../allocation"

/** HR Handloom, 2026-11-07: a 25,000 payment split across two bills. */
const base = {
  paymentId: "pay_25k",
  submissionId: "sub_new",
  paymentAmount: 25000,
  otherShares: 0,
  payoutTotal: 86743,
}

describe("checkAllocation (#2523)", () => {
  it("allows a share that fits the payment and the payout", () => {
    expect(checkAllocation({ ...base, amount: 25000 }).ok).toBe(true)
  })

  it("allows zero — 'none of this payment goes to that bill'", () => {
    expect(checkAllocation({ ...base, amount: 0 }).ok).toBe(true)
  })

  it("refuses when shares across payouts would exceed the payment", () => {
    const verdict = checkAllocation({ ...base, otherShares: 16380, amount: 10000 })
    expect(verdict.ok).toBe(false)
    expect((verdict as any).message).toContain("only 8620 is left")
  })

  it("allows exactly what is left", () => {
    expect(checkAllocation({ ...base, otherShares: 16380, amount: 8620 }).ok).toBe(true)
  })

  it("refuses a share larger than the payout bills", () => {
    const verdict = checkAllocation({ ...base, payoutTotal: 16380, amount: 20000 })
    expect(verdict.ok).toBe(false)
  })

  it("refuses a negative share", () => {
    expect(checkAllocation({ ...base, amount: -1 }).ok).toBe(false)
  })
})
