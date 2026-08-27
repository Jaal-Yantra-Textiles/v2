/**
 * A cost is not a price, and "we could not price this" is not "free".
 *
 * Every refusal below is a case that has already reached production somewhere
 * in this codebase in a different shape: a stored 0 charged as free (#1564), a
 * remembered FX rate off by 24% (#1538), a null that got `?? 1`-ed away.
 */
import {
  DEFAULT_CUSTOM_DESIGN_MARKUP_PERCENT,
  designQuoteUnitPrice,
} from "../lib/design-quote-price"

describe("designQuoteUnitPrice", () => {
  it("applies the 20% uplift to the estimated cost", () => {
    const result = designQuoteUnitPrice({
      total_estimated: 1000,
      confidence: "estimated",
    })
    expect(result.unit_price).toBe(1200)
    expect(result.basis).toBe(1000)
    expect(result.markup_percent).toBe(DEFAULT_CUSTOM_DESIGN_MARKUP_PERCENT)
    expect(result.reason).toBeNull()
  })

  it("converts before it marks up", () => {
    // 1000 INR at 0.012 = 12 USD, then +20% = 14.40. Marking up first and
    // converting after gives the same number here but not once rounding bites.
    const result = designQuoteUnitPrice({
      total_estimated: 1000,
      confidence: "estimated",
      fx_rate: 0.012,
    })
    expect(result.basis).toBe(12)
    expect(result.unit_price).toBe(14.4)
  })

  it("honours a caller's own markup", () => {
    const result = designQuoteUnitPrice({
      total_estimated: 100,
      confidence: "estimated",
      markup_percent: 50,
    })
    expect(result.unit_price).toBe(150)
  })

  describe("refusals — every one returns null, never 0", () => {
    it("refuses a null estimate (#1564)", () => {
      const result = designQuoteUnitPrice({ total_estimated: null })
      expect(result.unit_price).toBeNull()
      expect(result.reason).toMatch(/nothing to price/i)
    })

    it("refuses a stored 0, which means 'found nothing' (#1563)", () => {
      const result = designQuoteUnitPrice({
        total_estimated: 0,
        confidence: "estimated",
      })
      // 🔴 The one that matters. A 0 that survived to here would be minted as
      // an active price row and charged.
      expect(result.unit_price).toBeNull()
      expect(result.reason).toMatch(/zero/i)
    })

    it("refuses an estimate whose confidence is 'none'", () => {
      const result = designQuoteUnitPrice({
        total_estimated: 500,
        confidence: "none",
      })
      expect(result.unit_price).toBeNull()
    })

    it("refuses a FAILED conversion, and does not treat it as 'no conversion'", () => {
      const result = designQuoteUnitPrice({
        total_estimated: 1000,
        confidence: "estimated",
        fx_rate: null,
      })
      // Quoting 1000 INR as 1000 USD is the failure this prevents.
      expect(result.unit_price).toBeNull()
      expect(result.reason).toMatch(/exchange rate/i)
    })

    it("treats an omitted rate as same-currency, which is different from a failed one", () => {
      const result = designQuoteUnitPrice({
        total_estimated: 1000,
        confidence: "estimated",
      })
      expect(result.unit_price).toBe(1200)
    })

    it("refuses a nonsense rate", () => {
      expect(
        designQuoteUnitPrice({
          total_estimated: 1000,
          confidence: "estimated",
          fx_rate: 0,
        }).unit_price
      ).toBeNull()
      expect(
        designQuoteUnitPrice({
          total_estimated: 1000,
          confidence: "estimated",
          fx_rate: -1,
        }).unit_price
      ).toBeNull()
    })

    it("refuses a negative estimate", () => {
      expect(
        designQuoteUnitPrice({ total_estimated: -5, confidence: "estimated" })
          .unit_price
      ).toBeNull()
    })
  })
})
