import { planCloseAsReceived } from "../plan-close-as-received"

const base = {
  order_id: "inv_order_1",
  status: "Shipped",
  metadata: {},
  confirmed_on_books: false,
}

describe("planCloseAsReceived", () => {
  it("closes an order whose typed receipts cover every line", () => {
    const plan = planCloseAsReceived({
      ...base,
      lines: [
        { id: "l1", quantity: 10, received: 10 },
        { id: "l2", quantity: 5, received: 6 },
      ],
    })
    expect(plan).toEqual({ ok: true, mode: "covered", short_lines: [] })
  })

  it("treats integer-rounded receipts (45.2 ordered, 45 stored) as covered", () => {
    const plan = planCloseAsReceived({
      ...base,
      lines: [{ id: "l1", quantity: 45.2, received: 45 }],
    })
    expect(plan.ok && plan.mode).toBe("covered")
  })

  it("refuses a real shortfall unless the operator confirmed it is on the books", () => {
    const lines = [{ id: "l1", quantity: 30, received: 0 }]
    const refused = planCloseAsReceived({ ...base, lines })
    expect(refused.ok).toBe(false)
    expect(!refused.ok && refused.reason).toContain("l1: 0 of 30")

    const confirmed = planCloseAsReceived({ ...base, lines, confirmed_on_books: true })
    expect(confirmed).toEqual({
      ok: true,
      mode: "confirmed",
      short_lines: [{ line_id: "l1", ordered: 30, received: 0 }],
    })
  })

  it("always refuses an order whose receipts were reversed by hand, even if confirmed", () => {
    const plan = planCloseAsReceived({
      ...base,
      status: "Partial",
      metadata: { reversal_note: "Reversed 9 incorrect fulfillments" },
      confirmed_on_books: true,
      lines: [{ id: "l1", quantity: 16, received: 16 }],
    })
    expect(plan.ok).toBe(false)
    expect(!plan.ok && plan.reason).toContain("reversed by hand")
  })

  it.each(["Pending", "Processing", "Ready for Delivery", "Delivered", "Cancelled", null])(
    "refuses status %s",
    (status) => {
      const plan = planCloseAsReceived({
        ...base,
        status,
        confirmed_on_books: true,
        lines: [{ id: "l1", quantity: 1, received: 1 }],
      })
      expect(plan.ok).toBe(false)
    }
  )

  it("refuses an order with no quantified lines", () => {
    const plan = planCloseAsReceived({
      ...base,
      confirmed_on_books: true,
      lines: [{ id: "l1", quantity: 0, received: 0 }],
    })
    expect(plan.ok).toBe(false)
  })

  it("closes a Partial order only when its receipts cover it", () => {
    const plan = planCloseAsReceived({
      ...base,
      status: "Partial",
      lines: [{ id: "l1", quantity: 10, received: 10 }],
    })
    expect(plan.ok && plan.mode).toBe("covered")
  })
})
