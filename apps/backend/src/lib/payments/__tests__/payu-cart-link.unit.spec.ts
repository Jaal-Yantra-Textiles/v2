const createPayuLink = jest.fn()
jest.mock("../../../api/admin/lib/create-payu-link", () => ({
  createPayuLink: (...args: any[]) => createPayuLink(...args),
}))

import { createPayuLinkForCart } from "../payu-cart-link"

const scopeWith = (cart: any) => ({
  resolve: (key: string) =>
    key === "logger"
      ? { warn: jest.fn(), error: jest.fn() }
      : { graph: jest.fn(async () => ({ data: cart ? [cart] : [] })) },
})

const inrCart = (over: any = {}) => ({
  id: "cart_01",
  email: "buyer@example.com",
  currency_code: "inr",
  total: 11000,
  billing_address: { first_name: "A", last_name: "B", phone: "9000000000" },
  ...over,
})

beforeEach(() => {
  createPayuLink.mockReset()
  createPayuLink.mockResolvedValue({
    payment_link: "https://v.payu.in/abc",
    invoice_number: "inv1",
  })
})

describe("createPayuLinkForCart", () => {
  it("prices the link off the CART, and stamps the cart id as the reference", async () => {
    const out = await createPayuLinkForCart(scopeWith(inrCart()), "cart_01")

    expect(out.payment_link).toBe("https://v.payu.in/abc")
    // Asserted on mock.calls, not inside the mock — an expect() in a mock that
    // throws is swallowed by the caller's try/catch.
    const [input] = createPayuLink.mock.calls[0]
    expect(input.amount).toBe(11000)
    expect(input.reference).toBe("cart_01")
  })

  /**
   * 🔴 PayU settles in INR. `/store/payu/payment-link` only warns and builds the
   * link anyway, which presents a ₹ amount for a €150 cart. Here it refuses.
   */
  it("REFUSES a link for a non-INR cart, and never calls PayU", async () => {
    const out = await createPayuLinkForCart(
      scopeWith(inrCart({ currency_code: "eur" })),
      "cart_01"
    )

    expect(out.payment_link).toBeNull()
    expect(out.reason).toContain("EUR")
    expect(createPayuLink).not.toHaveBeenCalled()
  })

  it("refuses a zero total rather than asking the buyer for nothing", async () => {
    const out = await createPayuLinkForCart(scopeWith(inrCart({ total: 0 })), "cart_01")

    expect(out.payment_link).toBeNull()
    expect(createPayuLink).not.toHaveBeenCalled()
  })

  it("reports PayU's own failure instead of throwing", async () => {
    createPayuLink.mockResolvedValue({
      payment_link: null,
      invoice_number: null,
      error: "PayU OneAPI not configured",
    })
    const out = await createPayuLinkForCart(scopeWith(inrCart()), "cart_01")

    expect(out.payment_link).toBeNull()
    expect(out.reason).toContain("PayU OneAPI not configured")
  })

  it("reports a missing cart instead of throwing", async () => {
    const out = await createPayuLinkForCart(scopeWith(null), "cart_nope")

    expect(out.payment_link).toBeNull()
    expect(createPayuLink).not.toHaveBeenCalled()
  })
})
