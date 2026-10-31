import { buildOrderInvoiceVars, planScheduleResync } from "../order-invoice"

// Order #101 (Oshen) on 2026-10-31: deposit 94.43 paid on a 314.77 deal, then
// an edit raised the order to 441.79 and left the schedule at 220.34.
const schedule = {
  id: "sched_101",
  currency_code: "aud",
  total_due: 314.77,
  deposit_amount: 94.43,
  deposit_status: "paid",
  balance_amount: 220.34,
  balance_status: "due",
}
const editedOrder = {
  currency_code: "aud",
  total: 441.79,
  summary: { pending_difference: 347.36, paid_total: 94.43 },
}

describe("planScheduleResync", () => {
  it("moves the balance to what the edited order says is owed", () => {
    const plan = planScheduleResync({ schedule, order: editedOrder })
    expect(plan).toMatchObject({
      action: "resync",
      total_due: 441.79,
      balance_amount: 347.36,
      previous: { total_due: 314.77, balance_amount: 220.34 },
    })
  })

  it("does nothing when the schedule already matches", () => {
    const plan = planScheduleResync({
      schedule: { ...schedule, total_due: 441.79, balance_amount: 347.36 },
      order: editedOrder,
    })
    expect(plan.action).toBe("noop")
  })

  it("refuses when the paid figure is not the deposit", () => {
    const plan = planScheduleResync({
      schedule,
      order: { ...editedOrder, summary: { pending_difference: 300, paid_total: 141.79 } },
    })
    expect(plan.action).toBe("refuse")
  })

  it("refuses an unpaid deposit and a currency mismatch", () => {
    expect(
      planScheduleResync({ schedule: { ...schedule, deposit_status: "pending" }, order: editedOrder })
        .action
    ).toBe("refuse")
    expect(
      planScheduleResync({ schedule, order: { ...editedOrder, currency_code: "inr" } }).action
    ).toBe("refuse")
  })

  it("leaves a paid balance and a settled order alone", () => {
    expect(
      planScheduleResync({ schedule: { ...schedule, balance_status: "paid" }, order: editedOrder })
        .action
    ).toBe("noop")
    expect(
      planScheduleResync({
        schedule,
        order: { ...editedOrder, summary: { pending_difference: 0, paid_total: 441.79 } },
      }).action
    ).toBe("noop")
  })
})

describe("buildOrderInvoiceVars", () => {
  const order = {
    id: "order_101",
    display_id: 101,
    email: "oshen@example.com",
    currency_code: "aud",
    shipping_address: { first_name: "Sunda" },
    item_total: 396.82,
    shipping_total: 44.97,
    total: 441.79,
    summary: { pending_difference: 347.36, paid_total: 94.43 },
    items: [
      { product_title: "Handwoven Robe", variant_title: "Linen", quantity: 2, unit_price: 33.51 },
      { product_title: "Handwoven Scarf", variant_title: "One Size", quantity: 1, unit_price: 0 },
    ],
  }

  it("renders every line, with a free replacement shown as no charge", () => {
    const vars = buildOrderInvoiceVars({ order, pay_url: "https://pay/x", now: new Date("2026-10-31") })
    expect(vars.customer_first_name).toBe("Sunda")
    expect(vars.lines).toHaveLength(2)
    expect(vars.lines[0]).toMatchObject({ title: "Handwoven Robe", variant: "Linen", quantity: 2 })
    expect(vars.lines[0].line_total).toContain("67.02")
    expect(vars.lines[1]).toMatchObject({ unit_price: "No charge", line_total: "No charge" })
    expect(vars.lines[1].note).toMatch(/Replacement/)
    expect(vars.balance_due).toContain("347.36")
    expect(vars.pay_url).toBe("https://pay/x")
    expect(vars.order_total).toContain("441.79")
  })

  it("hides the balance and the link when nothing is owed", () => {
    const vars = buildOrderInvoiceVars({
      order: { ...order, summary: { pending_difference: 0, paid_total: 441.79 } },
      pay_url: "https://pay/x",
    })
    expect(vars.balance_due).toBe("")
    expect(vars.pay_url).toBe("")
  })
})
