import {
  defaultSizeLabels,
  evenSplit,
  formatSizeSplit,
  isNonSizedProductType,
  planDesignSizeSplit,
} from "../bundle-size-split"
import { runSizeSplitText } from "../notify-partner-of-work-order"

const jacket = { size_labels: ["38", "40"], colors: [], product_type: "jacket" }

describe("bundle size split (#2500)", () => {
  describe("the design's own sizes first", () => {
    it("splits evenly across them: Jacket No 1 × 2 → 38×1, 40×1", () => {
      const r = planDesignSizeSplit(jacket, { quantity: 2 })
      expect(r).toEqual({
        ok: true,
        quantity: 2,
        size_split: [
          { size_label: "38", quantity: 1 },
          { size_label: "40", quantity: 1 },
        ],
        planned_output: [
          { size_label: "38", color: null, quantity: 1 },
          { size_label: "40", color: null, quantity: 1 },
        ],
      })
    })

    it("gives the remainder to the earliest sizes", () => {
      expect(evenSplit(["S", "M", "L"], 5)).toEqual([
        { size_label: "S", quantity: 2 },
        { size_label: "M", quantity: 2 },
        { size_label: "L", quantity: 1 },
      ])
      // Fewer pieces than sizes: the sizes that get none are left out.
      expect(evenSplit(["S", "M", "L"], 1)).toEqual([{ size_label: "S", quantity: 1 }])
    })

    it("one size takes every piece: Bag for Paris × 10 → Custom Bag × 10", () => {
      const r = planDesignSizeSplit(
        { size_labels: ["Custom Bag"], colors: ["Black"], product_type: "tote_bag" },
        { quantity: 10 }
      )
      expect(r.ok && r.planned_output).toEqual([
        { size_label: "Custom Bag", color: "Black", quantity: 10 },
      ])
    })

    it("with several colours (parts of one piece), stores the size split with no colour", () => {
      const r = planDesignSizeSplit({ ...jacket, colors: ["Natural", "Red"] }, { quantity: 2 })
      expect(r.ok && r.planned_output).toEqual([
        { size_label: "38", color: null, quantity: 1 },
        { size_label: "40", color: null, quantity: 1 },
      ])
    })
  })

  describe("a design with no sizes", () => {
    it("default labels by quantity: 1 → M, 2 → S M, 3+ → M L XL", () => {
      expect(defaultSizeLabels(1)).toEqual(["M"])
      expect(defaultSizeLabels(2)).toEqual(["S", "M"])
      expect(defaultSizeLabels(3)).toEqual(["M", "L", "XL"])
      expect(evenSplit(defaultSizeLabels(4), 4)).toEqual([
        { size_label: "M", quantity: 2 },
        { size_label: "L", quantity: 1 },
        { size_label: "XL", quantity: 1 },
      ])
    })

    it("a garment is REFUSED, naming the sizes it needs — nothing is invented", () => {
      const r = planDesignSizeSplit({ size_labels: [], colors: [], product_type: "jacket" }, { quantity: 3 })
      expect(r).toMatchObject({ ok: false, missing_sizes: ["M", "L", "XL"] })
      if (r.ok) return
      expect(r.reason).toMatch(/Add M, L, XL with measurements/)
    })

    it("a design with no product type is treated as a garment", () => {
      expect(planDesignSizeSplit({ size_labels: [], colors: [] }, { quantity: 2 })).toMatchObject({
        ok: false,
        missing_sizes: ["S", "M"],
      })
    })

    it("a plainly unsized product goes as one quantity, as before", () => {
      const r = planDesignSizeSplit({ size_labels: [], colors: [], product_type: "tote_bag" }, { quantity: 10 })
      expect(r).toEqual({ ok: true, quantity: 10, size_split: null, planned_output: null })
    })

    it("matches product types by whole word: a cape is not a cap", () => {
      expect(isNonSizedProductType("tote_bag")).toBe(true)
      expect(isNonSizedProductType("Silk Scarf")).toBe(true)
      expect(isNonSizedProductType("cape")).toBe(false)
      expect(isNonSizedProductType("material jacket")).toBe(false)
      expect(isNonSizedProductType(null)).toBe(false)
    })
  })

  describe("the sender's own split", () => {
    it("wins, and its total is the quantity", () => {
      const r = planDesignSizeSplit(jacket, {
        planned_output: [
          { size_label: "38", quantity: 3 },
          { size_label: "40", quantity: 1 },
        ],
      })
      expect(r).toMatchObject({ ok: true, quantity: 4 })
    })

    it("is refused when it disagrees with the quantity given beside it", () => {
      const r = planDesignSizeSplit(jacket, {
        quantity: 2,
        planned_output: [{ size_label: "38", quantity: 3 }],
      })
      expect(r).toMatchObject({ ok: false })
      if (r.ok) return
      expect(r.reason).toMatch(/adds up to 3 pcs but the quantity says 2/)
    })

    it("cannot name a size the design does not state", () => {
      const r = planDesignSizeSplit(jacket, { planned_output: [{ size_label: "XL", quantity: 1 }] })
      expect(r).toMatchObject({ ok: false })
    })

    it("can send a sizeless garment as one-size", () => {
      const r = planDesignSizeSplit({ size_labels: [], colors: [], product_type: "jacket" }, {
        planned_output: [{ quantity: 3 }],
      })
      expect(r).toMatchObject({ ok: true, quantity: 3, size_split: null })
    })
  })

  describe("what the partner's message says", () => {
    it("reads the stored plan", () => {
      expect(
        runSizeSplitText({
          quantity: 2,
          planned_output: [
            { size_label: "38", color: null, quantity: 1 },
            { size_label: "40", color: null, quantity: 1 },
          ],
          snapshot: { size_sets: [{ size_label: "38" }, { size_label: "40" }] },
        })
      ).toBe("38×1, 40×1")
    })

    it("falls back to the same even split when no plan is stored", () => {
      expect(
        runSizeSplitText({ quantity: 3, snapshot: { size_sets: [{ size_label: "38" }, { size_label: "40" }] } })
      ).toBe("38×2, 40×1")
    })

    it("names a single size, and says nothing for an unsized run", () => {
      expect(runSizeSplitText({ quantity: 10, snapshot: { size_sets: [{ size_label: "Custom Bag" }] } })).toBe(
        "Custom Bag"
      )
      expect(runSizeSplitText({ quantity: 10, snapshot: { size_sets: [] } })).toBeNull()
      expect(formatSizeSplit(null)).toBeNull()
    })
  })
})
