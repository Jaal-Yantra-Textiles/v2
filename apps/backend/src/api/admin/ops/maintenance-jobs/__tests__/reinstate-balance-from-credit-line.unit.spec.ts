import { planReinstate, REVERSAL_REFERENCE, reversalRefId } from "../reinstate-balance-from-credit-line-lib"

// Order #176 as it stands on prod after the 90 AUD "Pricing Error" refund.
const rune = () => ({
  order: {
    id: "order_176",
    status: "pending",
    total: 105,
    credit_lines: [{ id: "ordcl_1", amount: 90, reference: "Pricing Error", reference_id: "pricing_error" }],
    captured: 195,
    refunded: 90,
  },
  credit_line_id: "ordcl_1",
  schedule: {
    id: "ps_1",
    deposit_status: "paid",
    balance_status: "not_due",
    total_due: 195,
    deposit_amount: 195,
    balance_amount: null,
  },
})

describe("planReinstate", () => {
  it("#176: total back to 195, deposit = 105 kept, balance 90 owed", () => {
    const p = planReinstate(rune())
    expect(p).toEqual({
      ok: true,
      reverse_amount: 90,
      total_before: 105,
      total_after: 195,
      net_paid: 105,
      balance: 90,
      schedule_update: { id: "ps_1", total_due: 195, deposit_amount: 105, balance_amount: 90 },
    })
  })

  it("refuses a credit line that is already reversed (no double run)", () => {
    const i = rune()
    i.order.credit_lines.push({ id: "ordcl_2", amount: -90, reference: REVERSAL_REFERENCE, reference_id: reversalRefId("ordcl_1") })
    expect(planReinstate(i)).toMatchObject({ ok: false, reason: expect.stringMatching(/already been reversed/) })
  })

  it("refuses once the balance was raised or paid", () => {
    for (const st of ["due", "paid", "waived", "failed"]) {
      const i = rune()
      i.schedule.balance_status = st
      expect(planReinstate(i).ok).toBe(false)
    }
  })

  it("refuses a missing credit line, a cancelled order, and no schedule", () => {
    expect(planReinstate({ ...rune(), credit_line_id: "nope" }).ok).toBe(false)
    expect(planReinstate({ ...rune(), order: { ...rune().order, status: "canceled" } }).ok).toBe(false)
    expect(planReinstate({ ...rune(), schedule: null }).ok).toBe(false)
  })

  it("refuses when nothing would be owed", () => {
    const i = rune()
    i.order.refunded = 0 // kept 195 of 195
    expect(planReinstate(i)).toMatchObject({ ok: false, reason: expect.stringMatching(/nothing to reinstate/) })
  })
})
