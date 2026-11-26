const runWorkflow = jest.fn()
jest.mock("../../email/workflows/send-design-order-created-email", () => ({
  sendDesignOrderCreatedEmailWorkflow: () => ({ run: runWorkflow }),
}))

jest.mock("../../../modules/payment_schedule", () => ({
  PAYMENT_SCHEDULE_MODULE: "payment_schedule",
}))

import { BOT_SUPPRESSED_SEND_ID } from "../../../lib/bot-recipients"
import {
  balanceWhen,
  deliverDesignOrderEmail,
  emailDeposit,
  emailLineItems,
} from "../deliver-design-order-email"

/** `graphCart` is what the cart reads back as — deliberately separate from the
 *  object handed in, because the caller's cart predates its own line items. */
const scopeWith = (graphCart: any, schedule: any = null) => ({
  resolve: (key: string) =>
    key === "query"
      ? { graph: jest.fn(async () => ({ data: graphCart ? [graphCart] : [] })) }
      : key === "payment_schedule"
        ? {
            findByCartId: jest.fn(async () => {
              if (schedule instanceof Error) throw schedule
              return schedule
            }),
          }
        : { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
})

/** A 50% manual deposit, as set_design_order_deposit / create write it. */
const manualSchedule = (over: any = {}) => ({
  id: "psch_1",
  source_type: "manual",
  deposit_status: "pending",
  currency_code: "inr",
  deposit_pct: 50,
  deposit_amount: 5500,
  total_due: 11000,
  balance_trigger: "manual",
  ...over,
})

describe("#2645 — the deposit section of the design-order email", () => {
  it("says what is due now, the balance and when, from the live total", async () => {
    // Stored 5500 was set before GST; the live total is 11550 → 50% is 5775.
    await deliverDesignOrderEmail(scopeWith(cart({ total: 11550 }), manualSchedule()), {
      cart: { id: "cart_01" },
      checkoutUrl: "https://x/c",
    })
    const data = runWorkflow.mock.calls[0][0].input.data
    expect(data.total).toBe(11550)
    expect(data.deposit).toEqual({
      amount: 5775,
      deposit_pct: 50,
      balance_amount: 5775,
      balance_trigger: "manual",
      balance_when: "when your order is ready — we'll email you a payment link",
    })
  })

  it("a fixed deposit has no percentage, and dispatch says 'ready to ship'", () => {
    const { deposit } = emailDeposit({
      schedule: manualSchedule({ deposit_pct: null, deposit_amount: 800, balance_trigger: "dispatch" }),
      total: 8400,
      currencyCode: "inr",
    })
    expect(deposit).toEqual({
      amount: 800,
      deposit_pct: null,
      balance_amount: 7600,
      balance_trigger: "dispatch",
      balance_when: "when your order is ready to ship — we'll email you a payment link",
    })
  })

  it("the balance is the remainder to the cent, not a second percentage", () => {
    // 10% of 287.049 = 28.70 (rounded); 90% would be 258.3441 — the remainder is 258.35.
    const { deposit } = emailDeposit({
      schedule: manualSchedule({ deposit_pct: 10 }),
      total: 287.049,
      currencyCode: "inr",
    })
    expect(deposit!.amount).toBe(28.7)
    expect(deposit!.balance_amount).toBe(258.35)
  })

  it("no schedule → no deposit section (pay in full, as before)", async () => {
    await deliverDesignOrderEmail(scopeWith(cart()), { cart: cart(), checkoutUrl: "https://x/c" })
    expect(runWorkflow.mock.calls[0][0].input.data.deposit).toBeNull()
  })

  it("refuses to send when the deposit cannot be charged as set (never quotes the total instead)", async () => {
    const out = await deliverDesignOrderEmail(
      scopeWith(cart(), manualSchedule({ deposit_status: "paid" })),
      { cart: cart(), checkoutUrl: "https://x/c" }
    )
    expect(out.sent).toBe(false)
    expect(runWorkflow).not.toHaveBeenCalled()
  })

  it("refuses to send when the schedule cannot be read (fails closed)", async () => {
    const out = await deliverDesignOrderEmail(scopeWith(cart(), new Error("db down")), {
      cart: cart(),
      checkoutUrl: "https://x/c",
    })
    expect(out.sent).toBe(false)
    expect(out.reason).toMatch(/deposit/)
    expect(runWorkflow).not.toHaveBeenCalled()
  })

  it("balanceWhen defaults to the manual wording", () => {
    expect(balanceWhen(undefined)).toBe(balanceWhen("manual"))
  })
})

const cart = (over: any = {}) => ({
  id: "cart_01",
  email: "buyer@example.com",
  currency_code: "inr",
  total: 11000,
  items: [{ id: "li_1" }],
  ...over,
})

beforeEach(() => {
  runWorkflow.mockReset()
  runWorkflow.mockResolvedValue({ result: { id: "notif_1" } })
})

describe("emailLineItems (#2576)", () => {
  it("shows each design with its picture, quantity and line price", () => {
    expect(
      emailLineItems([
        { title: "Unlined Kurta", thumbnail: "https://cdn.x/k.webp", quantity: 2, unit_price: 1450.5 },
      ])
    ).toEqual([
      { title: "Unlined Kurta", thumbnail: "https://cdn.x/k.webp", quantity: 2, unit_price: 1450.5, line_total: 2901 },
    ])
  })

  it("drops a line with no readable price rather than showing ₹0.00", () => {
    expect(emailLineItems([{ id: "li_1" }, { title: "A", unit_price: null, quantity: 1 }])).toEqual([])
  })

  it("keeps only http(s) pictures and names an untitled piece", () => {
    const [li] = emailLineItems([{ title: " ", thumbnail: "data:image/png;base64,xx", unit_price: 10, quantity: 1 }])
    expect(li.thumbnail).toBeNull()
    expect(li.title).toBe("Your piece")
  })

  it("is empty for a cart without items", () => {
    expect(emailLineItems(undefined)).toEqual([])
  })
})

describe("deliverDesignOrderEmail — items and GST in the email (#2576)", () => {
  it("passes the read-back lines and GST to the template", async () => {
    const graph = cart({
      tax_total: 72.53,
      items: [{ id: "li_1", title: "Kurta", thumbnail: "https://cdn.x/k.webp", quantity: 1, unit_price: 1450.5 }],
    })
    await deliverDesignOrderEmail(scopeWith(graph), { cart: { id: "cart_01" }, checkoutUrl: "https://x/c" })
    const data = runWorkflow.mock.calls[0][0].input.data
    expect(data.items).toEqual([expect.objectContaining({ title: "Kurta", line_total: 1450.5 })])
    expect(data.tax_total).toBe(72.53)
  })

  it("sends no GST row when the cart has no tax yet", async () => {
    await deliverDesignOrderEmail(scopeWith(cart()), { cart: cart(), checkoutUrl: "https://x/c" })
    expect(runWorkflow.mock.calls[0][0].input.data.tax_total).toBeNull()
  })
})

describe("deliverDesignOrderEmail — QR wording (#2572)", () => {
  const send = async (over: any) => {
    await deliverDesignOrderEmail(scopeWith(cart()), {
      cart: cart(),
      checkoutUrl: "https://x/checkout",
      ...over,
    })
    return runWorkflow.mock.calls[0][0].input.data
  }

  it("says UPI only when the QR really is a UPI intent", async () => {
    const data = await send({ paymentLink: "https://u.payu.in/a", paymentQrKind: "upi" })
    expect(data.payment_qr_kind).toBe("upi")
    expect(data.payment_qr_is_upi).toBe(true)
  })

  it("defaults to a link QR when the kind is not known (older callers)", async () => {
    const data = await send({ paymentLink: "https://u.payu.in/a" })
    expect(data.payment_qr_kind).toBe("link")
    expect(data.payment_qr_is_upi).toBe(false)
  })

  it("has no QR kind at all without a payment link", async () => {
    const data = await send({ paymentLink: null, paymentQrKind: "upi" })
    expect(data.payment_qr_kind).toBeNull()
    expect(data.payment_qr_is_upi).toBe(false)
  })
})

describe("deliverDesignOrderEmail", () => {
  it("sends the checkout link to the buyer", async () => {
    const out = await deliverDesignOrderEmail(scopeWith(cart()), {
      cart: cart(),
      checkoutUrl: "https://sharlho.cicilabel.com/in/checkout/cart/cart_01",
    })

    expect(out.sent).toBe(true)
    expect(out.to).toBe("buyer@example.com")
    // On mock.calls, not inside the mock — an expect() in a mock is swallowed.
    const [{ input }] = runWorkflow.mock.calls[0]
    expect(input.data.checkout_url).toBe(
      "https://sharlho.cicilabel.com/in/checkout/cart/cart_01"
    )
  })

  /** A design order with no buyer is ordinary here (#1817), not a failure. */
  it("does not treat a buyer-less order as a failed send", async () => {
    const out = await deliverDesignOrderEmail(scopeWith(cart({ email: null })), {
      cart: cart({ email: null }),
      checkoutUrl: "https://x.example/in/checkout/cart/cart_01",
    })

    expect(out.sent).toBe(false)
    expect(out.to).toBeNull()
    expect(out.reason).toContain("No buyer is attached")
    expect(runWorkflow).not.toHaveBeenCalled()
  })

  /** Telling a buyer an order exists with no way to pay is worse than silence. */
  it("refuses to send when there is no checkout link", async () => {
    const out = await deliverDesignOrderEmail(scopeWith(cart()), {
      cart: cart(),
      checkoutUrl: null,
    })

    expect(out.sent).toBe(false)
    expect(runWorkflow).not.toHaveBeenCalled()
  })

  /** #1333 — a suppressed send must never read as delivered. */
  it("reports a bot-suppressed send as NOT sent", async () => {
    runWorkflow.mockResolvedValue({ result: { id: BOT_SUPPRESSED_SEND_ID } })
    const out = await deliverDesignOrderEmail(scopeWith(cart()), {
      cart: cart(),
      checkoutUrl: "https://x.example/in/checkout/cart/cart_01",
    })

    expect(out.sent).toBe(false)
    expect(out.reason).toContain("crawler")
  })

  /**
   * The missing-template case. It must come back as a verdict, never as a
   * throw — the caller has already committed the cart.
   */
  it("returns a reason when the template row does not exist", async () => {
    runWorkflow.mockRejectedValue(
      new Error("Email template with key design-order-created not found")
    )
    const out = await deliverDesignOrderEmail(scopeWith(cart()), {
      cart: cart(),
      checkoutUrl: "https://x.example/in/checkout/cart/cart_01",
    })

    expect(out.sent).toBe(false)
    expect(out.reason).toContain("design-order-created")
  })

  /**
   * 🔴 The defect this guard exists for. The cart handed in by the create
   * workflow predates its own line items, so it carries NO total — and
   * `formatMoney` renders an absent amount as a well-formed "₹0.00" rather
   * than as nothing. The buyer would have been emailed a zero price.
   */
  it("reads the total BACK, rather than trusting the caller's cart", async () => {
    const out = await deliverDesignOrderEmail(scopeWith(cart({ total: 11000 })), {
      // What createDraftOrderFromDesignsWorkflow actually hands over.
      cart: { id: "cart_01", email: "buyer@example.com" },
      checkoutUrl: "https://x.example/in/checkout/cart/cart_01",
    })

    expect(out.sent).toBe(true)
    const [{ input }] = runWorkflow.mock.calls[0]
    expect(input.data.total).toBe(11000)
    expect(input.data.item_count).toBe(1)
  })

  it("REFUSES to email a zero price rather than quoting one", async () => {
    const out = await deliverDesignOrderEmail(scopeWith(cart({ total: undefined })), {
      cart: { id: "cart_01", email: "buyer@example.com" },
      checkoutUrl: "https://x.example/in/checkout/cart/cart_01",
    })

    expect(out.sent).toBe(false)
    expect(out.reason).toContain("zero price")
    expect(runWorkflow).not.toHaveBeenCalled()
  })
})
