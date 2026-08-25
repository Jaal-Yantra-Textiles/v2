import {
  DEFAULT_FLAT_FALLBACK,
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

  it("falls back to a DEFINED, non-zero default when nothing is configured", () => {
    // Deliberately not a refusal: no provider in this codebase throws from
    // calculatePrice, and a throw that propagates takes the whole shipping
    // options listing with it — leaving the buyer nothing, not even the manual
    // flat option that exists for exactly this case.
    const { amount, reason } = resolveFlatFallbackAmount({}, "US")

    expect(amount).toBe(DEFAULT_FLAT_FALLBACK)
    expect(amount).toBeGreaterThan(0)
    // The reason still travels, so the caller can log that this was a default
    // rather than a chosen number. That log is the only thing separating this
    // from the silent zero it replaced.
    expect(reason).toContain("US")
  })

  it("defaults when the config itself is absent", () => {
    expect(resolveFlatFallbackAmount(undefined, "IN").amount).toBe(
      DEFAULT_FLAT_FALLBACK
    )
  })

  it("still prefers a CONFIGURED amount over the default", () => {
    const { amount, reason } = resolveFlatFallbackAmount(
      { flat_fallback_amount: 777 },
      "IN"
    )
    expect(amount).toBe(777)
    // No reason: this number was chosen, so there is nothing to warn about.
    expect(reason).toBeUndefined()
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

/**
 * 🔴 A FALLBACK AMOUNT WITHOUT A CURRENCY IS A WRONG NUMBER WAITING.
 *
 * `calculated_amount` is denominated in the CART's currency. Every lookup here
 * used to be keyed on destination COUNTRY alone, so one figure had to serve
 * every currency a store sells in — and on prod nothing is configured at all,
 * so an unratable lane resolved to `DEFAULT_FLAT_FALLBACK` (200, an INR-shaped
 * number):
 *
 *   - a EUR cart to NL charged **€200** against an intended €35  (~6× high)
 *   - an INR cart abroad charged **₹200** against an intended ₹3200 (~16× low)
 *
 * Wrong in both directions, silently, at checkout. It stayed unreachable only
 * because international lanes were falling to the flat MANUAL option — and
 * leaning on live international rates is precisely what makes it reachable.
 */
describe("resolveFlatFallbackAmount — currency", () => {
  const intl = {
    flat_fallback_amounts: { eur: 35, usd: 39, inr: 3200 },
  }

  it("🔴 charges the EUR tier on a EUR cart, not the INR-shaped default", () => {
    expect(
      resolveFlatFallbackAmount(undefined, "NL", intl, "eur")
    ).toEqual({ amount: 35 })
  })

  it("🔴 charges the INR tier on an INR cart to the same country", () => {
    // Same destination, same option, different currency — and the answer MUST
    // differ. This is the assertion the old signature could not even express.
    expect(
      resolveFlatFallbackAmount(undefined, "NL", intl, "inr")
    ).toEqual({ amount: 3200 })
  })

  it("is case-insensitive about the currency code", () => {
    expect(resolveFlatFallbackAmount(undefined, "US", intl, "USD")).toEqual({
      amount: 39,
    })
  })

  /**
   * 🔑 Unknown currency SKIPS the map rather than picking from it. Taking "the
   * first entry" would be a coin-toss between €35 and ₹3200 — a plausible
   * wrong number, which is the exact thing this file exists to prevent.
   */
  it("🔑 skips the per-currency map when the currency is unknown", () => {
    const result = resolveFlatFallbackAmount(undefined, "NL", intl, undefined)
    expect(result.amount).toBe(200)
    expect(result.reason).toMatch(/almost certainly wrong in any other currency/i)
  })

  it("skips it for a currency the map does not carry", () => {
    expect(
      resolveFlatFallbackAmount(undefined, "NL", intl, "gbp").amount
    ).toBe(200)
  })

  /**
   * A configured 0 is a real answer — "this lane is free" — and must be
   * honoured rather than treated as absent.
   */
  it("honours a configured zero", () => {
    expect(
      resolveFlatFallbackAmount(
        undefined,
        "NL",
        { flat_fallback_amounts: { eur: 0 } },
        "eur"
      )
    ).toEqual({ amount: 0 })
  })

  /**
   * The per-currency map outranks the option-level scalar, which is by
   * construction a single-currency answer — it is what the DOMESTIC option
   * carries, where there is only ever one currency in play.
   */
  it("prefers the per-currency map over the option-level scalar", () => {
    expect(
      resolveFlatFallbackAmount(
        undefined,
        "NL",
        { flat_fallback_amount: 200, flat_fallback_amounts: { eur: 35 } },
        "eur"
      )
    ).toEqual({ amount: 35 })
  })

  /**
   * And the domestic option — a scalar, no map — is completely unaffected.
   * A change that fixed international by breaking the domestic lane would be
   * a poor trade: domestic is where the volume is.
   */
  it("leaves the domestic single-currency option exactly as it was", () => {
    expect(
      resolveFlatFallbackAmount(
        undefined,
        "IN",
        { flat_fallback_amount: 200 },
        "inr"
      )
    ).toEqual({ amount: 200 })
  })
})
