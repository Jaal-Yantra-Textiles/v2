import { hasZeroStoredCost } from "../clear-unpriceable-design-costs-job"

/**
 * Which designs are candidates for having their cost cleared (#1564).
 *
 * 🔴 The scope has to be exactly "stored cost is 0". A design whose cost is
 * null is already correct, and a design with a real cost must never be a
 * candidate — otherwise a mis-scoped run erases a price someone set by hand.
 */
describe("hasZeroStoredCost", () => {
  it("selects a design whose stored cost is 0", () => {
    // The residue of a recalculation that found nothing and wrote it down.
    expect(hasZeroStoredCost({ estimated_cost: 0 })).toBe(true)
  })

  it("selects a 0 that arrives as a string", () => {
    // The column comes back as a bigNumber-ish value; "0" is the same claim.
    // Reading it as truthy-only would silently skip every row on prod.
    expect(hasZeroStoredCost({ estimated_cost: "0" as any })).toBe(true)
  })

  it("does NOT select a design that is already null", () => {
    // Already correct — "no cost recorded". Nothing to repair.
    expect(hasZeroStoredCost({ estimated_cost: null })).toBe(false)
    expect(hasZeroStoredCost({})).toBe(false)
    expect(hasZeroStoredCost({ estimated_cost: undefined })).toBe(false)
  })

  it("does NOT select a design with a real cost", () => {
    // 🔴 The assertion that keeps this job from being destructive. A price
    // someone set deliberately must be untouchable by it.
    expect(hasZeroStoredCost({ estimated_cost: 850 })).toBe(false)
    expect(hasZeroStoredCost({ estimated_cost: "1200" as any })).toBe(false)
    expect(hasZeroStoredCost({ estimated_cost: 0.5 })).toBe(false)
  })

  it("does not select unparseable junk", () => {
    // NaN is not 0. Treating it as one would clear a row on the strength of a
    // value nobody can interpret.
    expect(hasZeroStoredCost({ estimated_cost: "abc" as any })).toBe(false)
    expect(hasZeroStoredCost({ estimated_cost: {} as any })).toBe(false)
  })
})
