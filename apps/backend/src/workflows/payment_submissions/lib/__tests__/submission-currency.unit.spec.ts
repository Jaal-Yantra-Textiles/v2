import {
  convertAmount,
  normaliseCurrency,
  resolveSubmissionCurrency,
  withConversion,
} from "../submission-currency"

describe("resolveSubmissionCurrency", () => {
  it("prefers what the caller explicitly asked for", () => {
    // An admin recording a payout already made in USD is stating a fact; the
    // partner default must not silently override it.
    expect(
      resolveSubmissionCurrency({ explicit: "usd", partnerCurrency: "inr" })
    ).toBe("usd")
  })

  it("falls back to the partner's own currency", () => {
    expect(resolveSubmissionCurrency({ partnerCurrency: "USD" })).toBe("usd")
  })

  it("falls back to inr when the partner's currency is null", () => {
    // hrhandloom's `currency_code` really is NULL on prod.
    expect(resolveSubmissionCurrency({ partnerCurrency: null })).toBe("inr")
  })

  it("ignores blank and whitespace-only values rather than adopting them", () => {
    expect(
      resolveSubmissionCurrency({ explicit: "   ", partnerCurrency: "eur" })
    ).toBe("eur")
  })

  it("normalises case", () => {
    expect(normaliseCurrency("  INR ")).toBe("inr")
  })
})

describe("convertAmount", () => {
  it("passes an amount through untouched when the currencies match", () => {
    const result = convertAmount({ amount: 8974, from: "inr", to: "inr" })

    expect(result.amount).toBe(8974)
    expect(result.conversion).toBeNull()
  })

  it("needs no rate for a same-currency line", () => {
    expect(() =>
      convertAmount({ amount: 100, from: "inr", to: "INR" })
    ).not.toThrow()
  })

  /**
   * 🔴 The load-bearing test. `amount * (rate ?? 1)` looks defensive and bills
   * a USD figure as rupees — off by ~88x with nothing in the record showing a
   * conversion was attempted. Refusing is the only safe answer.
   */
  it("REFUSES a cross-currency line with no rate rather than defaulting to 1", () => {
    expect(() => convertAmount({ amount: 93, from: "usd", to: "inr" })).toThrow(
      /without an exchange rate/
    )
  })

  it("refuses a zero, negative, NaN or infinite rate", () => {
    for (const rate of [0, -1, NaN, Infinity, null, undefined]) {
      expect(() =>
        convertAmount({ amount: 93, from: "usd", to: "inr", rate: rate as any })
      ).toThrow(/without an exchange rate/)
    }
  })

  it("converts and records the arithmetic so it can be replayed", () => {
    // The order #79 payout: $93 settled as rupees.
    const result = convertAmount({
      amount: 93,
      from: "usd",
      to: "inr",
      rate: 96.49,
    })

    expect(result.amount).toBe(8973.57)
    expect(result.conversion).toEqual({
      source_amount: 93,
      source_currency: "usd",
      target_currency: "inr",
      rate: 96.49,
      converted_amount: 8973.57,
    })
  })

  it("rounds to paise rather than leaving a floating-point tail", () => {
    const result = convertAmount({
      amount: 0.1 + 0.2,
      from: "usd",
      to: "inr",
      rate: 3,
    })

    expect(result.amount).toBe(0.9)
  })

  it("rejects a non-numeric amount instead of writing NaN", () => {
    expect(() =>
      convertAmount({ amount: undefined as any, from: "usd", to: "inr", rate: 90 })
    ).toThrow(/non-numeric amount/)
  })
})

describe("withConversion", () => {
  it("preserves what the pricing step already recorded", () => {
    const result = withConversion(
      { basis: "produced_quantity", rate: 1200 },
      {
        source_amount: 93,
        source_currency: "usd",
        target_currency: "inr",
        rate: 96.49,
        converted_amount: 8973.57,
      }
    )

    expect(result).toEqual({
      basis: "produced_quantity",
      rate: 1200,
      fx: {
        source_amount: 93,
        source_currency: "usd",
        target_currency: "inr",
        rate: 96.49,
        converted_amount: 8973.57,
      },
    })
  })

  it("leaves the breakdown alone when nothing was converted", () => {
    expect(withConversion({ basis: "total" }, null)).toEqual({ basis: "total" })
    expect(withConversion(null, null)).toBeNull()
  })
})
