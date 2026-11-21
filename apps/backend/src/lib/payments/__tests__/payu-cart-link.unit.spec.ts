const createPayuLink = jest.fn()
jest.mock("../../../api/admin/lib/create-payu-link", () => ({
  createPayuLink: (...args: any[]) => createPayuLink(...args),
}))

const deactivatePayuLink = jest.fn()
jest.mock("../payu-link-admin", () => ({
  deactivatePayuLink: (...args: any[]) => deactivatePayuLink(...args),
}))

import { createPayuLinkForCart } from "../payu-cart-link"

const updateCarts = jest.fn()
const logger = { warn: jest.fn(), error: jest.fn() }
const scopeWith = (cart: any, schedule: any = null) => ({
  resolve: (key: string) =>
    key === "logger"
      ? logger
      : key === "payment_schedule"
        ? { findByCartId: jest.fn(async () => schedule) }
        : key === "cart"
          ? { updateCarts }
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
  updateCarts.mockReset()
  logger.error.mockReset()
  deactivatePayuLink.mockReset()
  deactivatePayuLink.mockResolvedValue({ ok: true, error: null })
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

  it("🔴 asks for the DEPOSIT on a quote cart, not the total", async () => {
    // A 10% deal on an ₹11,000 cart: the link must be for ₹1,100.
    const out = await createPayuLinkForCart(
      scopeWith(inrCart(), {
        id: "psch_1",
        total_due: 11000,
        deposit_amount: 1100,
        deposit_status: "pending",
        currency_code: "inr",
      }),
      "cart_01"
    )
    expect(out.payment_link).toBe("https://v.payu.in/abc")
    expect(createPayuLink.mock.calls[0][0].amount).toBe(1100)
  })

  it("refuses a link on a cart whose deposit is already paid", async () => {
    const out = await createPayuLinkForCart(
      scopeWith(inrCart(), {
        id: "psch_1",
        total_due: 11000,
        deposit_amount: 1100,
        deposit_status: "paid",
        currency_code: "inr",
      }),
      "cart_01"
    )
    expect(out.payment_link).toBeNull()
    expect(createPayuLink).not.toHaveBeenCalled()
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

  describe("#2564 expiry", () => {
    const NOW = new Date("2026-11-21T13:00:00.000Z") // 18:30 IST

    it("🔴 sends PayU an expiryDate 48h out in IST, and tracks the link on the cart", async () => {
      const out = await createPayuLinkForCart(scopeWith(inrCart({ metadata: { keep: 1 } })), "cart_01", {
        now: NOW,
      })

      // Without expiryDate PayU keeps a link open for 365 days.
      expect(createPayuLink.mock.calls[0][0].expiryDate).toBe("2026-11-23 18:30:00")
      expect(out.expires_at).toBe("2026-11-23T13:00:00.000Z")
      expect(out.expires_label).toBe("Mon 23 Nov 2026, 6:30 pm IST")

      expect(updateCarts).toHaveBeenCalledTimes(1)
      const [id, data] = updateCarts.mock.calls[0]
      expect(id).toBe("cart_01")
      expect(data.metadata.keep).toBe(1)
      expect(data.metadata.payu_link).toEqual(
        expect.objectContaining({
          invoice_number: "inv1",
          url: "https://v.payu.in/abc",
          expires_at: "2026-11-23T13:00:00.000Z",
          closed_at: null,
        })
      )
    })

    it("🔴 switches the PREVIOUS link off when a new one is minted (amend)", async () => {
      const cart = inrCart({
        metadata: {
          payu_link: {
            invoice_number: "inv_old",
            url: "https://v.payu.in/old",
            expires_at: "2026-11-22T00:00:00.000Z",
            created_at: "2026-11-20T00:00:00.000Z",
          },
        },
      })
      const out = await createPayuLinkForCart(scopeWith(cart), "cart_01", { now: NOW })

      expect(deactivatePayuLink).toHaveBeenCalledWith("inv_old")
      expect(out.replaced_invoice_number).toBe("inv_old")
      expect(updateCarts.mock.calls[0][1].metadata.payu_link.invoice_number).toBe("inv1")
    })

    it("still returns the new link when switching the old one off fails — and says so loudly", async () => {
      deactivatePayuLink.mockResolvedValue({ ok: false, error: "boom" })
      const cart = inrCart({
        metadata: {
          payu_link: {
            invoice_number: "inv_old",
            url: "u",
            expires_at: "2026-11-22T00:00:00.000Z",
            created_at: "x",
          },
        },
      })
      const out = await createPayuLinkForCart(scopeWith(cart), "cart_01", { now: NOW })
      expect(out.payment_link).toBe("https://v.payu.in/abc")
      expect(out.replaced_invoice_number).toBeNull()
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("inv_old"))
    })

    it("does not try to close an already-closed previous link", async () => {
      const cart = inrCart({
        metadata: {
          payu_link: {
            invoice_number: "inv_old",
            url: "u",
            expires_at: "2026-11-22T00:00:00.000Z",
            created_at: "x",
            closed_at: "2026-11-21T00:00:00.000Z",
          },
        },
      })
      await createPayuLinkForCart(scopeWith(cart), "cart_01", { now: NOW })
      expect(deactivatePayuLink).not.toHaveBeenCalled()
    })
  })
})
