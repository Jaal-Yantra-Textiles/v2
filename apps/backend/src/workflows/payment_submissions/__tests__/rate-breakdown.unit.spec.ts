import { MedusaError } from "@medusajs/framework/utils"

import {
  assertBreakdownMatchesTotal,
  describeRateBreakdown,
  foldRateBreakdown,
  readRateBreakdown,
} from "../lib/rate-breakdown"

/**
 * Per-piece prices on one payout line (#1596). The case the issue was opened
 * for is the first: "3 at ₹850 and 1 at ₹1,200" had nowhere to live, and the
 * two available answers were to average it or to split the work into extra
 * runs purely to express pricing.
 */
describe("foldRateBreakdown", () => {
  it("totals the bands and refuses to invent a rate for a mixed line", () => {
    const folded = foldRateBreakdown([
      { quantity: 3, unit_amount: 850 },
      { quantity: 1, unit_amount: 1200 },
    ])

    expect(folded.quantity).toBe(4)
    expect(folded.amount).toBe(3750)
    // 🔴 NOT 937.50. An average is a rate nobody agreed to, and the model says
    // a reader wanting "3 × 850" must read `unit_amount` rather than dividing.
    expect(folded.unit_amount).toBeNull()
  })

  it("keeps the rate when every band agrees", () => {
    const folded = foldRateBreakdown([
      { quantity: 3, unit_amount: 850 },
      { quantity: 6, unit_amount: 850 },
    ])

    expect(folded.quantity).toBe(9)
    expect(folded.amount).toBe(7650)
    expect(folded.unit_amount).toBe(850)
  })

  it("rounds the total to the cent rather than carrying float noise", () => {
    const folded = foldRateBreakdown([
      { quantity: 3, unit_amount: 0.1 },
      { quantity: 1, unit_amount: 0.2 },
    ])

    expect(folded.amount).toBe(0.5)
  })
})

describe("assertBreakdownMatchesTotal", () => {
  const folded = foldRateBreakdown([
    { quantity: 3, unit_amount: 850 },
    { quantity: 1, unit_amount: 1200 },
  ])

  it("accepts a typed total that agrees", () => {
    expect(() =>
      assertBreakdownMatchesTotal("design_1", folded, 3750)
    ).not.toThrow()
  })

  it("accepts a cent of rounding drift", () => {
    expect(() =>
      assertBreakdownMatchesTotal("design_1", folded, 3750.01)
    ).not.toThrow()
  })

  it("🔴 refuses a total that disagrees, rather than picking a winner", () => {
    // Two spellings of one fact. Choosing silently is #1557: the money would be
    // decided by which branch ran first and surface weeks later as a shortfall.
    expect(() =>
      assertBreakdownMatchesTotal("design_1", folded, 3000)
    ).toThrow(MedusaError)
  })

  it("names both numbers so the caller can tell which is wrong", () => {
    try {
      assertBreakdownMatchesTotal("design_1", folded, 3000)
      throw new Error("expected a throw")
    } catch (e: any) {
      expect(e.message).toContain("3750")
      expect(e.message).toContain("3000")
      expect(e.message).toContain("design_1")
    }
  })

  it("says nothing when no total was stated", () => {
    expect(() =>
      assertBreakdownMatchesTotal("design_1", folded, null)
    ).not.toThrow()
  })
})

describe("readRateBreakdown", () => {
  it("returns the bands of a mixed line", () => {
    const slices = readRateBreakdown({
      rate_breakdown: [
        { quantity: 3, unit_amount: 850 },
        { quantity: 1, unit_amount: 1200 },
      ],
    })

    expect(slices).toHaveLength(2)
  })

  it("drops a single band — `quantity` and `unit_amount` already say that", () => {
    expect(
      readRateBreakdown({ rate_breakdown: [{ quantity: 9, unit_amount: 850 }] })
    ).toBeNull()
  })

  it("is null for the 20 of 21 lines that have no breakdown", () => {
    expect(readRateBreakdown({ rate_breakdown: null })).toBeNull()
    expect(readRateBreakdown({})).toBeNull()
  })

  it("ignores a malformed band rather than rendering NaN at a partner", () => {
    expect(
      readRateBreakdown({
        rate_breakdown: [
          { quantity: 3, unit_amount: 850 },
          { quantity: "many", unit_amount: 1200 },
        ],
      })
    ).toBeNull()
  })
})

describe("describeRateBreakdown", () => {
  it("says what the line is made of", () => {
    expect(
      describeRateBreakdown([
        { quantity: 3, unit_amount: 850 },
        { quantity: 1, unit_amount: 1200 },
      ])
    ).toBe("3 × 850 + 1 × 1200")
  })

  it("says nothing when there is nothing to say", () => {
    expect(describeRateBreakdown(null)).toBeNull()
    expect(describeRateBreakdown([])).toBeNull()
  })
})
