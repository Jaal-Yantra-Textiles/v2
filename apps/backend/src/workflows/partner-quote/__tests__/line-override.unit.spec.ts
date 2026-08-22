import {
  needsExchangeRate,
  resolveLineOverride,
} from "../lib/line-override"

/**
 * The trade price for one quoted line (#1439 S7).
 *
 * The assertion that matters most is the one about ZERO. `planQuotePrices`
 * drops a null rather than defaulting, which keeps an unpriceable line out of
 * the price list — but a zero is a perfectly valid number, so nothing drops it,
 * and it becomes an ACTIVE price of zero that the cart cheerfully charges.
 * Arithmetic is the fastest way to one, so every path that can produce it is
 * pinned here.
 */

const base = {
  live_unit_amount: 1000,
  fx_rate: 1,
  store_currency_code: "inr",
  quote_currency_code: "inr",
}

describe("resolveLineOverride", () => {
  it("leaves the catalog price alone when no override is given", () => {
    const res = resolveLineOverride(base)
    expect(res.unit_amount).toBe(1000)
    expect(res.override).toBeNull()
  })

  it("passes a null live price straight through rather than inventing one", () => {
    const res = resolveLineOverride({ ...base, live_unit_amount: null })
    // Null, not 0 — `planQuotePrices` drops it, which is the correct outcome
    // for a line the builder could not price.
    expect(res.unit_amount).toBeNull()
  })

  it("takes a percentage off the live price", () => {
    const res = resolveLineOverride({ ...base, discount_percent: 15 })
    expect(res.unit_amount).toBe(850)
    expect(res.override).toEqual({
      kind: "discount_percent",
      input_amount: 15,
      // A percentage has no currency, and recording one would invite a reader
      // to convert it.
      input_currency_code: null,
      fx_rate: 1,
    })
  })

  it("takes a flat override in the STORE's currency and records what was typed", () => {
    const res = resolveLineOverride({ ...base, override_unit_amount: 725 })
    expect(res.unit_amount).toBe(725)
    expect(res.override?.input_amount).toBe(725)
    expect(res.override?.input_currency_code).toBe("inr")
  })

  it("converts a flat override into the quote currency and persists the rate", () => {
    // The partner types rupees; the buyer is quoted in dollars.
    const res = resolveLineOverride({
      ...base,
      quote_currency_code: "usd",
      fx_rate: 0.012,
      override_unit_amount: 60000,
    })
    expect(res.unit_amount).toBe(720)
    // 🔑 The rate travels with the number. A quoted amount that cannot be
    // reproduced later is not evidence, and FX is exactly the input that will
    // have moved by the time anyone asks.
    expect(res.override?.fx_rate).toBe(0.012)
    expect(res.override?.input_amount).toBe(60000)
    expect(res.override?.input_currency_code).toBe("inr")
  })

  describe("🔴 never mints a price of zero", () => {
    it("refuses a 100% discount", () => {
      expect(() =>
        resolveLineOverride({ ...base, discount_percent: 100 })
      ).toThrow(/ACTIVE price of zero/)
    })

    it("refuses a flat override of 0", () => {
      expect(() =>
        resolveLineOverride({ ...base, override_unit_amount: 0 })
      ).toThrow(/ACTIVE price of zero/)
    })

    it("refuses a negative override", () => {
      expect(() =>
        resolveLineOverride({ ...base, override_unit_amount: -50 })
      ).toThrow(/ACTIVE price of zero/)
    })

    it("refuses a discount that rounds down to nothing", () => {
      // 99.999% of a 1000 unit price is 0.01 — still positive, still a real
      // decision. 100% of 0.004 is what this guards.
      expect(() =>
        resolveLineOverride({ ...base, live_unit_amount: 0.004, discount_percent: 50 })
      ).toThrow(/ACTIVE price of zero/)
    })
  })

  it("refuses a discount_percent outside 0-100", () => {
    expect(() => resolveLineOverride({ ...base, discount_percent: 120 })).toThrow(
      /between 0 and 100/
    )
    expect(() => resolveLineOverride({ ...base, discount_percent: -5 })).toThrow(
      /between 0 and 100/
    )
  })

  it("refuses a percentage on a line with no live price", () => {
    // A percentage OFF nothing is not a price.
    expect(() =>
      resolveLineOverride({ ...base, live_unit_amount: null, discount_percent: 10 })
    ).toThrow(/needs a live price/)
  })

  it("refuses both kinds on one line — 'which wins' must have no answer", () => {
    expect(() =>
      resolveLineOverride({
        ...base,
        discount_percent: 10,
        override_unit_amount: 700,
      })
    ).toThrow(/never both/)
  })

  it("refuses to convert without a usable rate rather than quoting rate 1", () => {
    // 🔴 A silent fallback to 1 does not fail — it quotes 60,000 INR as
    // 60,000 USD.
    expect(() =>
      resolveLineOverride({
        ...base,
        quote_currency_code: "usd",
        fx_rate: 0,
        override_unit_amount: 60000,
      })
    ).toThrow(/No usable exchange rate/)
  })
})

describe("needsExchangeRate", () => {
  const flat = [{ override_unit_amount: 700 }]

  it("is false when the store and quote currencies match", () => {
    // The common case must never touch the network, and an FX outage must
    // never block a same-currency mint.
    expect(needsExchangeRate(flat, "inr", "inr")).toBe(false)
    // Case is a storage detail, not a different currency.
    expect(needsExchangeRate(flat, "INR", "inr")).toBe(false)
  })

  it("is false when no line carries a flat override", () => {
    // A percentage needs no rate: it applies to a number already in the quote
    // currency.
    expect(needsExchangeRate([{ override_unit_amount: null }], "inr", "usd")).toBe(false)
    expect(needsExchangeRate([], "inr", "usd")).toBe(false)
  })

  it("is true only for a cross-currency flat override", () => {
    expect(needsExchangeRate(flat, "inr", "usd")).toBe(true)
  })
})
