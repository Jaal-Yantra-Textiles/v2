import { canCustomerCancel } from "../self-cancel"

const cashOrder = {
  status: "pending",
  customer_id: "cus_1",
  fulfillments: [],
  payment_collections: [
    { payments: [{ captured_at: null, captures: [] }] },
  ],
}

describe("canCustomerCancel", () => {
  it("allows an unpaid, unshipped cash order of the same customer", () => {
    expect(canCustomerCancel(cashOrder, "cus_1")).toEqual({ ok: true })
  })

  it("hides another customer's order as not found", () => {
    expect(canCustomerCancel(cashOrder, "cus_2")).toEqual({
      ok: false,
      reason: "Order not found",
    })
  })

  it("refuses a guest order (no customer) to everyone", () => {
    const r = canCustomerCancel({ ...cashOrder, customer_id: null }, "cus_1")
    expect(r.ok).toBe(false)
  })

  it("refuses an order with a captured payment (PayU refund is broken, #2580)", () => {
    const paid = {
      ...cashOrder,
      payment_collections: [{ payments: [{ captured_at: "2026-11-26", captures: [] }] }],
    }
    expect(canCustomerCancel(paid, "cus_1").ok).toBe(false)
    const paidViaCaptures = {
      ...cashOrder,
      payment_collections: [{ payments: [{ captured_at: null, captures: [{ id: "capt_1" }] }] }],
    }
    expect(canCustomerCancel(paidViaCaptures, "cus_1").ok).toBe(false)
  })

  it("refuses once a fulfillment exists, but not for a cancelled one", () => {
    expect(
      canCustomerCancel({ ...cashOrder, fulfillments: [{ canceled_at: null }] }, "cus_1").ok
    ).toBe(false)
    expect(
      canCustomerCancel(
        { ...cashOrder, fulfillments: [{ canceled_at: "2026-11-26" }] },
        "cus_1"
      )
    ).toEqual({ ok: true })
  })

  it("refuses cancelled and completed orders", () => {
    expect(canCustomerCancel({ ...cashOrder, status: "canceled" }, "cus_1")).toEqual({
      ok: false,
      reason: "This order is already cancelled",
    })
    expect(canCustomerCancel({ ...cashOrder, status: "completed" }, "cus_1").ok).toBe(false)
  })
})
