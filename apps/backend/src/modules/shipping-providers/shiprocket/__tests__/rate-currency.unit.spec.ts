import {
  SHIPROCKET_RATE_CURRENCY,
  applyRateToCarrierAmount,
  hasKnownCurrency,
  needsRateConversion,
} from "../rate-currency"

/**
 * The currency of a Shiprocket quote (#1417 follow-up).
 *
 * Reproduced on prod 2026-09-05: an AU-region cart with a Melbourne address was
 * quoted `calculated_amount: 890`. Shiprocket answers in rupees, so that is
 * ₹890 — about A$16 — charged as **A$890**. The same option's configured AUD
 * fallback is 55, so the fallback was right and the live path was ~55× wrong.
 */
describe("needsRateConversion", () => {
  it("leaves an INR cart alone — a rate of 1.0 from a cache is worse than not asking", () => {
    expect(needsRateConversion("inr")).toBe(false)
    expect(needsRateConversion("INR")).toBe(false)
    expect(needsRateConversion(" inr ")).toBe(false)
  })

  it("converts for every other currency", () => {
    for (const c of ["aud", "eur", "usd", "gbp", "idr", "ils"]) {
      expect(needsRateConversion(c)).toBe(true)
    }
  })

  it("treats an unknown currency as needing conversion, so it can never pass through raw", () => {
    expect(needsRateConversion(undefined)).toBe(true)
    expect(needsRateConversion(null)).toBe(true)
    expect(needsRateConversion("")).toBe(true)
  })
})

describe("hasKnownCurrency", () => {
  it("is false when the cart currency never arrived", () => {
    expect(hasKnownCurrency(undefined)).toBe(false)
    expect(hasKnownCurrency(null)).toBe(false)
    expect(hasKnownCurrency("   ")).toBe(false)
  })

  it("is true for a real code", () => {
    expect(hasKnownCurrency("aud")).toBe(true)
  })
})

describe("applyRateToCarrierAmount", () => {
  /**
   * The exact figure from the prod reproduction. At roughly 0.018 AUD per INR,
   * ₹890 is about A$16 — not A$890.
   */
  it("turns the measured ₹890 into a plausible AUD amount", () => {
    const out = applyRateToCarrierAmount(890, 0.018)
    expect(out).toBeCloseTo(16.02, 2)
    expect(out!).toBeLessThan(100)
  })

  it("rounds to 2dp, because this lands on an invoice", () => {
    expect(applyRateToCarrierAmount(3119, 0.0182)).toBe(56.77)
  })

  /**
   * 🔴 A zero or NaN rate would produce free shipping — the silent zero the
   * flat fallback was built to end. It must not return through this door.
   */
  it("refuses a rate that would make shipping free", () => {
    expect(applyRateToCarrierAmount(890, 0)).toBeNull()
    expect(applyRateToCarrierAmount(890, -1)).toBeNull()
    expect(applyRateToCarrierAmount(890, Number.NaN)).toBeNull()
    expect(applyRateToCarrierAmount(890, Number.POSITIVE_INFINITY)).toBeNull()
  })

  it("refuses an unusable amount", () => {
    expect(applyRateToCarrierAmount(Number.NaN, 0.018)).toBeNull()
    expect(applyRateToCarrierAmount(-5, 0.018)).toBeNull()
  })

  it("keeps a genuine zero-cost quote at zero rather than rejecting it", () => {
    expect(applyRateToCarrierAmount(0, 0.018)).toBe(0)
  })

  it("names the currency the carrier actually answers in", () => {
    expect(SHIPROCKET_RATE_CURRENCY).toBe("INR")
  })
})
