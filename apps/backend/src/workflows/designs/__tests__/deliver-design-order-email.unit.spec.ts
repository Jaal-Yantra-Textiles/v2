const runWorkflow = jest.fn()
jest.mock("../../email/workflows/send-design-order-created-email", () => ({
  sendDesignOrderCreatedEmailWorkflow: () => ({ run: runWorkflow }),
}))

import { BOT_SUPPRESSED_SEND_ID } from "../../../lib/bot-recipients"
import { deliverDesignOrderEmail } from "../deliver-design-order-email"

const scope = {
  resolve: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}

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

describe("deliverDesignOrderEmail", () => {
  it("sends the checkout link to the buyer", async () => {
    const out = await deliverDesignOrderEmail(scope, {
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
    const out = await deliverDesignOrderEmail(scope, {
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
    const out = await deliverDesignOrderEmail(scope, {
      cart: cart(),
      checkoutUrl: null,
    })

    expect(out.sent).toBe(false)
    expect(runWorkflow).not.toHaveBeenCalled()
  })

  /** #1333 — a suppressed send must never read as delivered. */
  it("reports a bot-suppressed send as NOT sent", async () => {
    runWorkflow.mockResolvedValue({ result: { id: BOT_SUPPRESSED_SEND_ID } })
    const out = await deliverDesignOrderEmail(scope, {
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
    const out = await deliverDesignOrderEmail(scope, {
      cart: cart(),
      checkoutUrl: "https://x.example/in/checkout/cart/cart_01",
    })

    expect(out.sent).toBe(false)
    expect(out.reason).toContain("design-order-created")
  })
})
