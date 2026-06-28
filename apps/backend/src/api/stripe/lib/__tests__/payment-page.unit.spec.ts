import {
  buildStripePaymentPageHtml,
  clientSecretOf,
  escapeHtml,
  formatAmount,
  pickStripeSession,
} from "../payment-page"

describe("pickStripeSession", () => {
  it("finds the stripe session by provider id substring", () => {
    const cart = {
      payment_collection: {
        payment_sessions: [
          { id: "ps_1", provider_id: "pp_system_default" },
          { id: "ps_2", provider_id: "pp_stripe_stripe" },
        ],
      },
    }
    expect(pickStripeSession(cart)?.id).toBe("ps_2")
  })

  it("returns null when there is no stripe session", () => {
    expect(pickStripeSession({ payment_collection: { payment_sessions: [] } })).toBeNull()
    expect(pickStripeSession({})).toBeNull()
  })
})

describe("clientSecretOf", () => {
  it("reads the client_secret off the session data", () => {
    expect(clientSecretOf({ data: { client_secret: "pi_1_secret_abc" } })).toBe("pi_1_secret_abc")
  })
  it("returns null when absent or non-string", () => {
    expect(clientSecretOf({ data: {} })).toBeNull()
    expect(clientSecretOf({ data: { client_secret: 123 } })).toBeNull()
    expect(clientSecretOf(null)).toBeNull()
  })
})

describe("formatAmount", () => {
  it("formats a known currency", () => {
    expect(formatAmount(1299, "usd")).toBe("$1,299.00")
  })
  it("falls back gracefully for an unknown currency code", () => {
    const out = formatAmount(10, "zzz")
    expect(out).toContain("10")
    expect(out).toContain("ZZZ")
  })
  it("handles non-numeric amounts", () => {
    expect(formatAmount("nope", "usd")).toBe("USD")
  })
})

describe("escapeHtml", () => {
  it("escapes html-significant characters", () => {
    expect(escapeHtml(`<script>"x"&'y'</script>`)).toBe(
      "&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;"
    )
  })
})

describe("buildStripePaymentPageHtml", () => {
  it("renders the pay state with Stripe.js, the publishable key and client secret JSON-injected", () => {
    const html = buildStripePaymentPageHtml({
      state: "pay",
      publishableKey: "pk_test_123",
      clientSecret: "pi_1_secret_abc",
      amountLabel: "$10.00",
      returnUrl: "https://v3.example.com/stripe/pay/cart_1",
      title: "Complete your payment",
    })
    expect(html).toContain("https://js.stripe.com/v3/")
    expect(html).toContain('Stripe("pk_test_123")')
    expect(html).toContain('const clientSecret = "pi_1_secret_abc"')
    expect(html).toContain('"https://v3.example.com/stripe/pay/cart_1"')
    expect(html).toContain("payment-element")
    expect(html).toContain("$10.00")
  })

  it("renders a paid state without Stripe.js or any secret", () => {
    const html = buildStripePaymentPageHtml({ state: "paid" })
    expect(html).not.toContain("js.stripe.com")
    expect(html).toContain("Payment received")
  })

  it("renders an unavailable state with a custom message", () => {
    const html = buildStripePaymentPageHtml({ state: "unavailable", message: "No Stripe session yet." })
    expect(html).not.toContain("js.stripe.com")
    expect(html).toContain("No Stripe session yet.")
  })

  it("does not break out of the JS string literal on adversarial input", () => {
    const html = buildStripePaymentPageHtml({
      state: "pay",
      publishableKey: 'pk"; alert(1); //',
      clientSecret: "cs",
      returnUrl: "r",
    })
    // The quote is JSON-escaped, not emitted raw into the script literal.
    expect(html).toContain('Stripe("pk\\"; alert(1); //")')
    expect(html).not.toContain('Stripe("pk"; alert(1)')
  })
})
