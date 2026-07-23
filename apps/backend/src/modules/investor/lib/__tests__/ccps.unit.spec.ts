import { computeConvertibleValue } from "../convertible-value"
import { computeConversion } from "../convertible-conversion"

describe("computeConvertibleValue — CCPS liquidation-preference floor", () => {
  it("floors a CCPS implied value at principal × multiple on a down round", () => {
    // principal 1,000,000; cap 10,000,000 → 10% ownership. Reference valuation
    // 5,000,000 (down round) would imply 500,000 — but the 1x preference floors
    // it at the principal.
    const v = computeConvertibleValue(
      {
        principal_amount: 1_000_000,
        valuation_cap: 10_000_000,
        safe_type: "post_money",
        instrument_type: "ccps",
        liquidation_preference_multiple: 1,
      },
      { referenceValuation: 5_000_000 }
    )
    expect(v.implied_value).toBe(1_000_000)
    expect(v.multiple).toBe(1)
  })

  it("applies a 2x preference floor", () => {
    const v = computeConvertibleValue(
      {
        principal_amount: 1_000_000,
        valuation_cap: 10_000_000,
        safe_type: "post_money",
        instrument_type: "ccps",
        liquidation_preference_multiple: 2,
      },
      { referenceValuation: 5_000_000 }
    )
    expect(v.implied_value).toBe(2_000_000)
    expect(v.multiple).toBe(2)
  })

  it("does NOT floor when the implied value already exceeds the preference", () => {
    // Up round: reference 20,000,000 → 10% = 2,000,000, well above the 1x floor.
    const v = computeConvertibleValue(
      {
        principal_amount: 1_000_000,
        valuation_cap: 10_000_000,
        safe_type: "post_money",
        instrument_type: "ccps",
        liquidation_preference_multiple: 1,
      },
      { referenceValuation: 20_000_000 }
    )
    expect(v.implied_value).toBe(2_000_000)
  })

  it("does NOT apply the floor to a plain SAFE (non-CCPS)", () => {
    const v = computeConvertibleValue(
      {
        principal_amount: 1_000_000,
        valuation_cap: 10_000_000,
        safe_type: "post_money",
        instrument_type: "safe",
        liquidation_preference_multiple: 1,
      },
      { referenceValuation: 5_000_000 }
    )
    expect(v.implied_value).toBe(500_000)
  })
})

describe("computeConversion — SAFE/note/loan → equity or CCPS shares", () => {
  it("uses the valuation cap price when it beats the round price", () => {
    // cap 10,000,000 / 1,000,000 FDS = 10/share cap price vs 20 round price.
    const r = computeConversion(
      { principal_amount: 1_000_000, valuation_cap: 10_000_000 },
      { round_price_per_share: 20, fully_diluted_shares: 1_000_000 }
    )
    expect(r.basis).toBe("cap")
    expect(r.conversion_price_per_share).toBe(10)
    expect(r.conversion_shares).toBe(100_000)
  })

  it("uses the discount price when there is no cap", () => {
    // 20% discount off a 10 round price = 8/share.
    const r = computeConversion(
      { principal_amount: 800_000, discount_rate: 0.2 },
      { round_price_per_share: 10 }
    )
    expect(r.basis).toBe("discount")
    expect(r.conversion_price_per_share).toBe(8)
    expect(r.conversion_shares).toBe(100_000)
  })

  it("honours an explicit share override", () => {
    const r = computeConversion(
      { principal_amount: 500_000 },
      { shares: 5_000 }
    )
    expect(r.basis).toBe("explicit")
    expect(r.conversion_shares).toBe(5_000)
    expect(r.conversion_price_per_share).toBe(100)
  })

  it("converts a loan by ratio off pre-issued shares when no priced round is given", () => {
    // A 2-year-old loan already carrying 1,000 pre-shares, 1:1 ratio.
    const r = computeConversion(
      { principal_amount: 1_000_000, num_shares: 1_000, conversion_ratio: 1 },
      {}
    )
    expect(r.basis).toBe("ratio")
    expect(r.conversion_shares).toBe(1_000)
  })

  it("returns nulls when nothing can be derived", () => {
    const r = computeConversion({ principal_amount: 1_000_000 }, {})
    expect(r.conversion_shares).toBeNull()
    expect(r.basis).toBe("unknown")
  })
})
