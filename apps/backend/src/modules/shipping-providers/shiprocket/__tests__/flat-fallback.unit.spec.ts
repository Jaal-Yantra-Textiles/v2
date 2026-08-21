import {
  parseFlatFallbackAmounts,
  resolveFlatFallbackAmount,
} from "../flat-fallback"

describe("resolveFlatFallbackAmount", () => {
  it("prefers the country-specific amount over the catch-all", () => {
    // A domestic lane and a cross-border one are not the same order of
    // magnitude; one number for both is wrong in one direction or the other.
    expect(
      resolveFlatFallbackAmount(
        { flat_fallback_amounts: { US: 249000 }, flat_fallback_amount: 9900 },
        "US"
      )
    ).toEqual({ amount: 249000 })
  })

  it("matches the country case-insensitively", () => {
    expect(
      resolveFlatFallbackAmount({ flat_fallback_amounts: { us: 249000 } }, "US")
        .amount
    ).toBe(249000)
  })

  it("falls through to the catch-all for an unlisted country", () => {
    expect(
      resolveFlatFallbackAmount(
        { flat_fallback_amounts: { US: 249000 }, flat_fallback_amount: 9900 },
        "AE"
      )
    ).toEqual({ amount: 9900 })
  })

  it("honours a configured ZERO instead of treating it as absent", () => {
    // "This lane is free" is a real answer somebody chose. Only ABSENCE may
    // fall through — the whole point of this module is that an unchosen 0 and a
    // chosen 0 must stop being the same value.
    expect(
      resolveFlatFallbackAmount({ flat_fallback_amounts: { IN: 0 } }, "IN")
    ).toEqual({ amount: 0 })
  })

  it("defaults an absent destination to IN", () => {
    expect(
      resolveFlatFallbackAmount({ flat_fallback_amounts: { IN: 9900 } }, undefined)
        .amount
    ).toBe(9900)
  })

  it("refuses — naming the country — when nothing is configured", () => {
    const { amount, reason } = resolveFlatFallbackAmount({}, "US")

    expect(amount).toBeUndefined()
    expect(reason).toContain("US")
  })

  it("refuses when the config itself is absent", () => {
    expect(resolveFlatFallbackAmount(undefined, "IN").amount).toBeUndefined()
  })
})

describe("parseFlatFallbackAmounts", () => {
  it("parses ISO2=minor-unit pairs", () => {
    expect(parseFlatFallbackAmounts("IN=9900,US=249000")).toEqual({
      IN: 9900,
      US: 249000,
    })
  })

  it("uppercases keys and tolerates whitespace", () => {
    expect(parseFlatFallbackAmounts(" in = 9900 ")).toEqual({ IN: 9900 })
  })

  it("DROPS malformed pairs rather than coercing them to zero", () => {
    // A typo that silently became 0 would be the original silent-zero bug with
    // extra steps. Dropping it surfaces as the loud "nothing configured" error.
    expect(parseFlatFallbackAmounts("IN=abc,US=249000")).toEqual({ US: 249000 })
    expect(parseFlatFallbackAmounts("IN=-5")).toBeUndefined()
    expect(parseFlatFallbackAmounts("IN")).toBeUndefined()
  })

  it("returns undefined for empty input", () => {
    expect(parseFlatFallbackAmounts("")).toBeUndefined()
    expect(parseFlatFallbackAmounts(undefined)).toBeUndefined()
  })
})
