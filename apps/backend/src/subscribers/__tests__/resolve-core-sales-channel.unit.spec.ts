import { pickCoreSalesChannelId } from "../lib/resolve-core-sales-channel"

// #859 S2 (#861) — the pure env-vs-fallback pick for the core sales channel.
describe("pickCoreSalesChannelId", () => {
  it("prefers the explicit env channel id", () => {
    expect(
      pickCoreSalesChannelId({
        envChannelId: "sc_core",
        defaultStorefrontChannelId: "sc_fallback",
      })
    ).toBe("sc_core")
  })

  it("trims whitespace around the env value", () => {
    expect(
      pickCoreSalesChannelId({
        envChannelId: "  sc_core  ",
        defaultStorefrontChannelId: "sc_fallback",
      })
    ).toBe("sc_core")
  })

  it("falls back to the default storefront channel when env is unset", () => {
    expect(
      pickCoreSalesChannelId({
        envChannelId: undefined,
        defaultStorefrontChannelId: "sc_fallback",
      })
    ).toBe("sc_fallback")
  })

  it("falls back when env is an empty / whitespace string", () => {
    expect(
      pickCoreSalesChannelId({
        envChannelId: "   ",
        defaultStorefrontChannelId: "sc_fallback",
      })
    ).toBe("sc_fallback")
  })

  it("returns null when neither is available", () => {
    expect(
      pickCoreSalesChannelId({
        envChannelId: null,
        defaultStorefrontChannelId: null,
      })
    ).toBeNull()
  })
})
