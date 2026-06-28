import { findStripeSession, resolveStripeProvider } from "../init-session"

describe("resolveStripeProvider", () => {
  it("returns the enabled stripe provider on the region", () => {
    expect(
      resolveStripeProvider([
        { id: "pp_system_default", is_enabled: true },
        { id: "pp_stripe_stripe", is_enabled: true },
      ])
    ).toBe("pp_stripe_stripe")
  })

  it("ignores a disabled stripe provider", () => {
    expect(
      resolveStripeProvider([{ id: "pp_stripe_stripe", is_enabled: false }])
    ).toBeNull()
  })

  it("returns null when no stripe provider is enabled (e.g. an INR/PayU region)", () => {
    expect(
      resolveStripeProvider([
        { id: "pp_payu_payu", is_enabled: true },
        { id: "pp_system_default", is_enabled: true },
      ])
    ).toBeNull()
  })

  it("honors an explicit override", () => {
    expect(resolveStripeProvider([], "pp_stripe_custom")).toBe("pp_stripe_custom")
  })

  it("treats undefined is_enabled as enabled", () => {
    expect(resolveStripeProvider([{ id: "pp_stripe_stripe" }])).toBe("pp_stripe_stripe")
  })
})

describe("findStripeSession", () => {
  it("finds a stripe session among the collection's sessions", () => {
    const found = findStripeSession([
      { id: "ps_a", provider_id: "pp_system_default" },
      { id: "ps_b", provider_id: "pp_stripe_stripe" },
    ])
    expect(found?.id).toBe("ps_b")
  })
  it("returns null when none present or input missing", () => {
    expect(findStripeSession([{ id: "ps_a", provider_id: "pp_payu_payu" }])).toBeNull()
    expect(findStripeSession(undefined)).toBeNull()
  })
})
