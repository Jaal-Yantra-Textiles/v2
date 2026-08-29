import { MedusaError } from "@medusajs/framework/utils"

import {
  assertBreakdownMatchesTotal,
  describeRateBreakdown,
  foldRateBreakdown,
  groupIntoRateBands,
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

/**
 * #1596, the writer half. The bands rendered from day one and NOTHING could
 * produce one — both create screens hit the mixed-rate case and sent a typed
 * line total instead, throwing the structure away. This is the grouping the two
 * screens now share.
 */
describe("groupIntoRateBands (#1596)", () => {
  it("merges runs at the same rate and orders the bands by rate", () => {
    expect(
      groupIntoRateBands([
        { quantity: 1, unit_amount: 1200 },
        { quantity: 2, unit_amount: 850 },
        { quantity: 1, unit_amount: 850 },
      ])
    ).toEqual([
      { quantity: 3, unit_amount: 850 },
      { quantity: 1, unit_amount: 1200 },
    ])
  })

  it("orders by rate, not by the order the runs were picked", () => {
    // A Set iterates in insertion order, so grouping without a sort makes the
    // payload depend on which run an admin ticked first — two spellings of one
    // agreement.
    const a = groupIntoRateBands([
      { quantity: 1, unit_amount: 1200 },
      { quantity: 3, unit_amount: 850 },
    ])
    const b = groupIntoRateBands([
      { quantity: 3, unit_amount: 850 },
      { quantity: 1, unit_amount: 1200 },
    ])
    expect(a).toEqual(b)
  })

  it("returns null when every run agrees on one rate", () => {
    // One rate is an ordinary priced line. It belongs in quantity +
    // unit_amount, where every existing reader already looks — and the
    // validator refuses a single band anyway.
    expect(
      groupIntoRateBands([
        { quantity: 3, unit_amount: 850 },
        { quantity: 5, unit_amount: 850 },
      ])
    ).toBeNull()
  })

  it("returns null for nothing at all", () => {
    expect(groupIntoRateBands([])).toBeNull()
    expect(groupIntoRateBands(null)).toBeNull()
    expect(groupIntoRateBands(undefined)).toBeNull()
  })

  it("drops figures the validator would refuse rather than sending a 400", () => {
    // A zero or negative in a rate box would fail `.positive()` for the WHOLE
    // submission, not just that run.
    expect(
      groupIntoRateBands([
        { quantity: 3, unit_amount: 850 },
        { quantity: 0, unit_amount: 1200 },
        { quantity: 2, unit_amount: -5 },
        { quantity: 1, unit_amount: 1200 },
      ])
    ).toEqual([
      { quantity: 3, unit_amount: 850 },
      { quantity: 1, unit_amount: 1200 },
    ])
  })

  it("collapses to null when the surviving runs share one rate", () => {
    expect(
      groupIntoRateBands([
        { quantity: 3, unit_amount: 850 },
        { quantity: 1, unit_amount: 0 },
      ])
    ).toBeNull()
  })

  it("keeps a summed fractional quantity off the float's edge", () => {
    // 0.1 + 0.2 is 0.30000000000000004, and the validator would record a
    // quantity nobody typed.
    expect(
      groupIntoRateBands([
        { quantity: 0.1, unit_amount: 850 },
        { quantity: 0.2, unit_amount: 850 },
        { quantity: 1, unit_amount: 1200 },
      ])
    ).toEqual([
      { quantity: 0.3, unit_amount: 850 },
      { quantity: 1, unit_amount: 1200 },
    ])
  })

  it("folds back to exactly the total the collapsed line used to send", () => {
    // The old behaviour sent Σ(qty × rate) as a typed total. The bands must
    // reach the same number, or this change moves money.
    const runs = [
      { quantity: 3, unit_amount: 850 },
      { quantity: 1, unit_amount: 1200 },
    ]
    const bands = groupIntoRateBands(runs)!
    const oldTotal =
      Math.round(runs.reduce((s, r) => s + r.quantity * r.unit_amount, 0) * 100) / 100
    expect(foldRateBreakdown(bands).amount).toBe(oldTotal)
    // …and states no single rate, because there isn't one.
    expect(foldRateBreakdown(bands).unit_amount).toBeNull()
  })
})
