import {
  checkOutputLines,
  childPlannedOutput,
  resolveProducedOutput,
  runGoodQuantity,
  runOutputAxes,
  soleCombination,
} from "../lib/run-output"

/**
 * #2271 — a run's output per size/colour.
 *
 * The Luong Shirt run on prod is the shape this exists for: a design stating S
 * and M, a run of 3, and nothing anywhere saying which sizes were made — so the
 * goods could only be banked onto one sizeless variant.
 */
const LUONG = {
  size_sets: [{ size_label: "S" }, { size_label: "M" }],
  colors: [],
}
const ONE_SIZE = { size_sets: [{ size_label: "M" }], colors: [] }
const NO_AXES = { size_sets: [], colors: [] }
const SIZED_AND_COLOURED = {
  size_sets: [{ size_label: "S" }, { size_label: "M" }],
  colors: [{ name: "Indigo" }, { name: "Rust" }],
}

describe("run output per size/colour (#2271)", () => {
  describe("runOutputAxes", () => {
    it("reads sizes and colour NAMES from the snapshot, deduped, in stated order", () => {
      expect(
        runOutputAxes({
          size_sets: [{ size_label: " M " }, { size_label: "S" }, { size_label: "M" }],
          colors: [{ name: "Rust", hex_code: "#a33" }, { name: "" }],
        })
      ).toEqual({ sizes: ["M", "S"], colors: ["Rust"] })
    })

    it("is empty for a snapshot with neither", () => {
      expect(runOutputAxes(null)).toEqual({ sizes: [], colors: [] })
    })
  })

  describe("checkOutputLines", () => {
    const axes = runOutputAxes(LUONG)

    it("accepts a split that adds up, and merges duplicate lines", () => {
      const res = checkOutputLines(
        [
          { size_label: "S", quantity: 1 },
          { size_label: "M", quantity: 1 },
          { size_label: "M", quantity: 1 },
        ],
        axes,
        3
      )
      expect(res).toEqual({
        ok: true,
        lines: [
          { size_label: "S", color: null, quantity: 1 },
          { size_label: "M", color: null, quantity: 2 },
        ],
      })
    })

    it("drops zero lines, so a pre-filled form can send sizes nobody made", () => {
      const res = checkOutputLines(
        [
          { size_label: "S", quantity: 0 },
          { size_label: "M", quantity: 3 },
        ],
        axes,
        3
      )
      expect(res.ok && res.lines).toEqual([{ size_label: "M", color: null, quantity: 3 }])
    })

    it("refuses a split that does not add up", () => {
      const res = checkOutputLines([{ size_label: "M", quantity: 2 }], axes, 3)
      expect(res.ok).toBe(false)
    })

    it("refuses a sizeless line on a sized run — the ambiguity this removes", () => {
      expect(checkOutputLines([{ quantity: 3 }], axes, 3).ok).toBe(false)
    })

    it("refuses a size the run was never for", () => {
      expect(checkOutputLines([{ size_label: "XL", quantity: 3 }], axes, 3).ok).toBe(false)
    })

    it("refuses a colour on a design that states none", () => {
      expect(
        checkOutputLines([{ size_label: "M", color: "Rust", quantity: 3 }], axes, 3).ok
      ).toBe(false)
    })

    it("requires every axis the run states", () => {
      const both = runOutputAxes(SIZED_AND_COLOURED)
      expect(checkOutputLines([{ size_label: "M", quantity: 1 }], both, 1).ok).toBe(false)
      expect(
        checkOutputLines([{ size_label: "M", color: "Rust", quantity: 1 }], both, 1).ok
      ).toBe(true)
    })

    it("does not check the total for an open-ended run", () => {
      expect(checkOutputLines([{ size_label: "M", quantity: 7 }], axes, null).ok).toBe(true)
    })

    it("refuses a negative or missing quantity", () => {
      expect(checkOutputLines([{ size_label: "M", quantity: -1 }], axes).ok).toBe(false)
      expect(checkOutputLines([{ size_label: "M" } as any], axes).ok).toBe(false)
      expect(checkOutputLines("M:3" as any, axes).ok).toBe(false)
    })
  })

  describe("soleCombination", () => {
    it("answers for a run stating at most one of each", () => {
      expect(soleCombination(runOutputAxes(ONE_SIZE))).toEqual({ size_label: "M", color: null })
      expect(soleCombination(runOutputAxes(NO_AXES))).toEqual({ size_label: null, color: null })
    })

    it("abstains on several", () => {
      expect(soleCombination(runOutputAxes(LUONG))).toBeNull()
    })
  })

  describe("resolveProducedOutput", () => {
    it("the confirmed split wins over the plan", () => {
      const res = resolveProducedOutput({
        confirmed: [
          { size_label: "S", quantity: 2 },
          { size_label: "M", quantity: 1 },
        ],
        planned_output: [
          { size_label: "S", quantity: 1 },
          { size_label: "M", quantity: 2 },
        ],
        snapshot: LUONG,
        good_quantity: 3,
      })
      expect(res).toMatchObject({ ok: true, source: "confirmed" })
      expect(res.ok && res.lines.find((l) => l.size_label === "S")?.quantity).toBe(2)
    })

    it("an invalid confirmed split is an ERROR, never replaced by the plan", () => {
      const res = resolveProducedOutput({
        confirmed: [{ size_label: "S", quantity: 1 }],
        planned_output: [
          { size_label: "S", quantity: 1 },
          { size_label: "M", quantity: 2 },
        ],
        snapshot: LUONG,
        good_quantity: 3,
      })
      expect(res).toMatchObject({ ok: false, code: "invalid_confirmed" })
    })

    it("takes the plan when it adds up to the good units", () => {
      const res = resolveProducedOutput({
        planned_output: [
          { size_label: "S", quantity: 1 },
          { size_label: "M", quantity: 2 },
        ],
        snapshot: LUONG,
        good_quantity: 3,
      })
      expect(res).toMatchObject({ ok: true, source: "planned" })
    })

    it("does NOT take a plan for 3 when 2 good units were made — it cannot say which 2", () => {
      const res = resolveProducedOutput({
        planned_output: [
          { size_label: "S", quantity: 1 },
          { size_label: "M", quantity: 2 },
        ],
        snapshot: LUONG,
        good_quantity: 2,
      })
      expect(res).toMatchObject({ ok: false, code: "split_required" })
    })

    it("infers the only combination a run states", () => {
      expect(
        resolveProducedOutput({ snapshot: ONE_SIZE, good_quantity: 4 })
      ).toEqual({
        ok: true,
        source: "sole_combination",
        lines: [{ size_label: "M", color: null, quantity: 4 }],
      })
    })

    /** Luong Shirt ×3, as it stands on prod. */
    it("asks, rather than guessing, for several sizes with no plan", () => {
      const res = resolveProducedOutput({ snapshot: LUONG, good_quantity: 3 })
      expect(res).toMatchObject({ ok: false, code: "split_required" })
      expect(!res.ok && res.reason).toContain("S, M")
    })

    it("records nothing for zero good units", () => {
      expect(
        resolveProducedOutput({ snapshot: LUONG, good_quantity: 0 })
      ).toEqual({ ok: true, lines: [], source: "none" })
    })
  })

  describe("childPlannedOutput", () => {
    const plan = [
      { size_label: "S", quantity: 1 },
      { size_label: "M", quantity: 2 },
    ]

    it("inherits the parent's plan when the child covers the same total", () => {
      expect(
        childPlannedOutput({ parent: plan, snapshot: LUONG, quantity: 3 })
      ).toEqual([
        { size_label: "S", color: null, quantity: 1 },
        { size_label: "M", color: null, quantity: 2 },
      ])
    })

    it("gets NO plan for a different share rather than a wrong one", () => {
      expect(childPlannedOutput({ parent: plan, snapshot: LUONG, quantity: 2 })).toBeNull()
    })

    it("uses the assignment's own plan, and refuses an invalid one", () => {
      expect(
        childPlannedOutput({
          assignment: [{ size_label: "M", quantity: 2 }],
          parent: plan,
          snapshot: LUONG,
          quantity: 2,
        })
      ).toEqual([{ size_label: "M", color: null, quantity: 2 }])

      expect(() =>
        childPlannedOutput({
          assignment: [{ size_label: "XL", quantity: 2 }],
          snapshot: LUONG,
          quantity: 2,
          partnerId: "p_1",
        })
      ).toThrow(/p_1/)
    })
  })

  /**
   * The split must add up to exactly what stocking banks, so both read this.
   * Pinned to stocking's existing arithmetic — see the OPEN note on the helper.
   */
  describe("runGoodQuantity", () => {
    it("is produced less rejected, as stocking has always banked", () => {
      expect(runGoodQuantity({ produced_quantity: 3, rejected_quantity: 1, quantity: 3 })).toBe(2)
    })

    it("falls back to the ordered quantity when nothing was reported", () => {
      expect(runGoodQuantity({ quantity: 4 })).toBe(4)
    })

    it("never goes negative", () => {
      expect(runGoodQuantity({ produced_quantity: 1, rejected_quantity: 3 })).toBe(0)
    })
  })
})
