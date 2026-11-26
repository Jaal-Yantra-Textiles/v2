import { readFileSync } from "fs"
import * as path from "path"

import {
  buildRefundEmailVars,
  orderRefunds,
  stampRefundEmail,
  wasRefundEmailed,
} from "../order-refund-email-vars"
import { ORDER_REFUNDED_HTML, ORDER_REFUNDED_SUBJECT } from "../order-refunded-template"

const mockSendRun = jest.fn()
jest.mock("../../../workflows/email/workflows/send-notification-email", () => ({
  sendNotificationEmailWorkflow: () => ({ run: mockSendRun }),
}))
jest.mock("../../../modules/partner_billing/resolve-retail-partner", () => ({
  resolveRetailPartnerId: async () => null,
}))

import { renderRefundEmail, sendRefundEmailForPayment, sendOrderRefundEmail } from "../order-refund-email"

/**
 * Rune's order (#2645): a 50% deposit order of A$180 charged in full, then
 * A$90 refunded. Medusa booked the refund as a credit line, so order.total
 * now reads 90, and "total − paid" would say nothing is owed. The schedule
 * says the A$90 balance is still to come when the order is ready.
 */
const depositOrder = () => ({
  id: "order_rune",
  display_id: 183,
  email: "rune@example.com",
  currency_code: "aud",
  total: 90, // after the credit line: NOT what is owed
  metadata: { foo: "bar" },
  customer: { first_name: "Rune" },
  payment_collections: [
    {
      captured_amount: 180,
      refunded_amount: 90,
      payments: [
        {
          id: "pay_1",
          provider_id: "pp_stripe_stripe",
          captures: [{ id: "capt_1", amount: 180 }],
          refunds: [{ id: "ref_1", amount: 90, created_at: "2026-11-26T05:00:00Z" }],
        },
      ],
    },
  ],
})

const depositSchedule = {
  id: "psch_1",
  total_due: 180,
  deposit_amount: 90,
  deposit_status: "paid",
  balance_amount: 90,
  balance_status: "not_due",
  balance_trigger: "manual",
}

const paidInFullOrder = () => ({
  id: "order_full",
  display_id: 200,
  email: "buyer@example.com",
  currency_code: "inr",
  total: 4000,
  shipping_address: { first_name: "Asha" },
  payment_collections: [
    {
      captured_amount: 5000,
      refunded_amount: 0,
      payments: [
        {
          id: "pay_2",
          provider_id: "pp_payu_payu",
          data: { mode: "UPI" },
          captures: [{ id: "c2", amount: 5000 }],
          refunds: [{ id: "ref_2", amount: 1000, created_at: "2026-11-25T00:00:00Z" }],
        },
      ],
    },
  ],
})

describe("buildRefundEmailVars", () => {
  it("deposit order: states the balance from the schedule, not the credit-lined order total", () => {
    const v = buildRefundEmailVars({
      order: depositOrder(),
      schedule: depositSchedule,
      refund_amount: 90,
      now: new Date("2026-11-26"),
    })
    expect(v.customer_first_name).toBe("Rune")
    expect(v.order_display_id).toBe("#183")
    expect(v.refund_amount).toBe("A$90.00")
    expect(v.paid_total).toBe("A$180.00")
    expect(v.refunded_total).toBe("A$90.00")
    expect(v.net_paid).toBe("A$90.00")
    expect(v.balance_due).toBe("A$90.00")
    expect(v.balance_when).toBe("when your order is ready")
    expect(v.balance_due_now).toBe(false)
    expect(v.paid_in_full).toBe(false)
    expect(v.payment_method).toBe("card via Stripe")
  })

  it("dispatch trigger reads 'when your order ships'; a raised balance is due now with its link", () => {
    const ships = buildRefundEmailVars({
      order: depositOrder(),
      schedule: { ...depositSchedule, balance_trigger: "dispatch" },
      refund_amount: 90,
    })
    expect(ships.balance_when).toBe("when your order ships")

    const due = buildRefundEmailVars({
      order: depositOrder(),
      schedule: { ...depositSchedule, balance_status: "due", balance_link_ref: "https://pay/x" },
      refund_amount: 90,
    })
    expect(due.balance_due_now).toBe(true)
    expect(due.balance_when).toBeNull()
    expect(due.balance_link).toBe("https://pay/x")
  })

  it("a paid or waived balance owes nothing", () => {
    for (const balance_status of ["paid", "waived"]) {
      const v = buildRefundEmailVars({
        order: depositOrder(),
        schedule: { ...depositSchedule, balance_status },
        refund_amount: 90,
      })
      expect(v.balance_due).toBeNull()
      expect(v.paid_in_full).toBe(true)
    }
  })

  it("fully-paid order (no schedule): no balance, net paid = captured − refunded", () => {
    const v = buildRefundEmailVars({ order: paidInFullOrder(), schedule: null, refund_amount: 1000 })
    expect(v.customer_first_name).toBe("Asha")
    expect(v.refund_amount).toBe("₹1,000.00")
    expect(v.paid_total).toBe("₹5,000.00")
    expect(v.net_paid).toBe("₹4,000.00")
    expect(v.balance_due).toBeNull()
    expect(v.balance_when).toBeNull()
    expect(v.paid_in_full).toBe(true)
    expect(v.payment_method).toBe("UPI via PayU")
  })

  it("note present is kept verbatim; absent or blank is null", () => {
    const note = "Your order had a 50% deposit, but you were charged in full. We've refunded the difference."
    expect(
      buildRefundEmailVars({ order: depositOrder(), schedule: depositSchedule, refund_amount: 90, note }).note
    ).toBe(note)
    expect(buildRefundEmailVars({ order: depositOrder(), refund_amount: 90 }).note).toBeNull()
    expect(buildRefundEmailVars({ order: depositOrder(), refund_amount: 90, note: "   " }).note).toBeNull()
  })

  it("orderRefunds lists newest first", () => {
    const o: any = depositOrder()
    o.payment_collections[0].payments[0].refunds.push({
      id: "ref_0",
      amount: 5,
      created_at: "2026-11-20T00:00:00Z",
    })
    expect(orderRefunds(o).map((r) => r.id)).toEqual(["ref_1", "ref_0"])
  })
})

describe("rendered template", () => {
  it("shows the note block only when a note is given, and the balance wording", () => {
    const withNote = renderRefundEmail(
      { subject: ORDER_REFUNDED_SUBJECT, html: ORDER_REFUNDED_HTML },
      buildRefundEmailVars({
        order: depositOrder(),
        schedule: depositSchedule,
        refund_amount: 90,
        note: "Charged in full by mistake.",
      })
    )
    expect(withNote.subject).toBe("We've refunded A$90.00 on order #183")
    expect(withNote.html).toContain("Charged in full by mistake.")
    expect(withNote.html).toContain("WHY YOU'RE GETTING THIS")
    expect(withNote.html).toContain("for the balance of A$90.00 when your order is ready")
    expect(withNote.html).toContain("5–10 business days")
    expect(withNote.html).toContain("Jaal Yantra Textiles")
    expect(withNote.html).not.toMatch(/visit the store/i)

    const without = renderRefundEmail(
      { subject: ORDER_REFUNDED_SUBJECT, html: ORDER_REFUNDED_HTML },
      buildRefundEmailVars({ order: paidInFullOrder(), refund_amount: 1000 })
    )
    expect(without.html).not.toContain("WHY YOU'RE GETTING THIS")
    expect(without.html).toContain("Nothing more to pay")
  })

  it("the operator's .html copy is identical to the code constant", () => {
    const file = readFileSync(
      path.join(__dirname, "../../../scripts/templates/order-refunded.html"),
      "utf8"
    )
    expect(file).toBe(ORDER_REFUNDED_HTML)
  })
})

describe("idempotency per refund id", () => {
  it("stamps once and recognises the stamp", () => {
    const m1 = stampRefundEmail({ foo: "bar" }, { refund_id: "ref_1", sent_at: "t", source: "auto" })
    expect(m1.foo).toBe("bar")
    expect(wasRefundEmailed(m1, "ref_1")).toBe(true)
    expect(wasRefundEmailed(m1, "ref_2")).toBe(false)
    const m2 = stampRefundEmail(m1, { refund_id: "ref_1", sent_at: "t2", source: "manual" })
    expect(m2.refund_emails_sent).toHaveLength(1)
  })

  const fakeContainer = () => {
    const state: { order: any } = { order: depositOrder() }
    const query = {
      graph: jest.fn(async ({ entity }: any) => {
        if (entity === "payment") {
          return {
            data: [
              {
                id: "pay_1",
                refunds: state.order.payment_collections[0].payments[0].refunds,
                payment_collection: { order: { id: state.order.id } },
              },
            ],
          }
        }
        return { data: [state.order] }
      }),
    }
    const orders = {
      updateOrders: jest.fn(async ([u]: any) => {
        state.order = { ...state.order, metadata: u.metadata }
      }),
    }
    const services: Record<string, any> = {
      query,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      order: orders,
      payment_schedule: { findByOrderId: async () => depositSchedule },
    }
    return { container: { resolve: (k: string) => services[k] }, state, orders }
  }

  beforeEach(() => mockSendRun.mockReset().mockResolvedValue({ result: { id: "msg_1" } }))

  it("a redelivered payment.refunded event does not send twice", async () => {
    const { container, state, orders } = fakeContainer()
    const first: any = await sendRefundEmailForPayment(container, "pay_1")
    expect(first.sent).toBe(true)
    expect(first.refund_id).toBe("ref_1")
    expect(mockSendRun).toHaveBeenCalledTimes(1)
    expect(mockSendRun.mock.calls[0][0].input.template).toBe("order-refunded")
    expect(mockSendRun.mock.calls[0][0].input.data.balance_due).toBe("A$90.00")
    expect(orders.updateOrders).toHaveBeenCalledTimes(1)
    expect(state.order.metadata.foo).toBe("bar")

    const second: any = await sendRefundEmailForPayment(container, "pay_1")
    expect(second.sent).toBe(false)
    expect(second.reason).toMatch(/already emailed/)
    expect(mockSendRun).toHaveBeenCalledTimes(1)
  })

  it("a bot-suppressed send is not reported as sent and not stamped", async () => {
    mockSendRun.mockResolvedValue({ result: { id: "suppressed-bot-recipient" } })
    const { container, orders } = fakeContainer()
    const out: any = await sendRefundEmailForPayment(container, "pay_1")
    expect(out.sent).toBe(false)
    expect(out.reason).toMatch(/crawler/)
    expect(orders.updateOrders).not.toHaveBeenCalled()
  })

  it("preview sends nothing and stamps nothing", async () => {
    const { container, orders } = fakeContainer()
    // No live template row: render from the code copy.
    const { MedusaError } = jest.requireActual("@medusajs/framework/utils")
    ;(container as any).resolve = ((orig) => (k: string) =>
      k === "email_templates"
        ? {
            getTemplateByKey: async () => {
              throw new MedusaError(MedusaError.Types.NOT_FOUND, "nope")
            },
          }
        : orig(k))((container as any).resolve)
    const out = await sendOrderRefundEmail(container, {
      order_id: "order_rune",
      note: "Charged in full by mistake.",
      preview: true,
    })
    expect(out.preview).toBe(true)
    expect(out.sent).toBe(false)
    expect(out.template_source).toBe("repo")
    expect(out.to).toBe("rune@example.com")
    expect(out.subject).toBe("We've refunded A$90.00 on order #183")
    expect(out.html).toContain("Charged in full by mistake.")
    expect(mockSendRun).not.toHaveBeenCalled()
    expect(orders.updateOrders).not.toHaveBeenCalled()
  })
})
