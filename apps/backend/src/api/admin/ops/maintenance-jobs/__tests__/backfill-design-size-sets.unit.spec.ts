import {
  decideDesignSizeSetBackfill,
  summarizeSizeSetBackfill,
} from "../backfill-design-size-sets-job"

/**
 * Pure planner for the custom_sizes → size_sets backfill. No container/DB.
 * The scenario: AI-generated designs stored `custom_sizes` (e.g. the prod
 * "Butterfly in muslin" with { L, S }) but never populated `size_sets`, so the
 * design manager's Sizes section showed nothing.
 */
describe("decideDesignSizeSetBackfill", () => {
  it("skips a design that already has size_sets (idempotent)", () => {
    expect(
      decideDesignSizeSetBackfill(true, { L: { chest: 50 } })
    ).toEqual({ action: "skip_has_size_sets" })
  })

  it("ports a legacy custom_sizes map (the Butterfly-in-muslin shape)", () => {
    const decision = decideDesignSizeSetBackfill(false, {
      L: { chest: 0, length: 0 },
      S: { chest: 0, length: 0 },
    })
    expect(decision.action).toBe("port")
    if (decision.action === "port") {
      expect(decision.sizeSets).toEqual([
        { size_label: "L", measurements: { chest: 0, length: 0 } },
        { size_label: "S", measurements: { chest: 0, length: 0 } },
      ])
    }
  })

  it("coerces numeric-string measurements", () => {
    const decision = decideDesignSizeSetBackfill(false, {
      M: { chest: "48", length: "60" },
    })
    expect(decision.action).toBe("port")
    if (decision.action === "port") {
      expect(decision.sizeSets).toEqual([
        { size_label: "M", measurements: { chest: 48, length: 60 } },
      ])
    }
  })

  it("skips when custom_sizes is empty / null", () => {
    expect(decideDesignSizeSetBackfill(false, null).action).toBe(
      "skip_no_convertible"
    )
    expect(decideDesignSizeSetBackfill(false, {}).action).toBe(
      "skip_no_convertible"
    )
  })

  it("skips when a label has no numeric measurements", () => {
    expect(
      decideDesignSizeSetBackfill(false, { S: { note: "loose" } }).action
    ).toBe("skip_no_convertible")
  })
})

describe("summarizeSizeSetBackfill", () => {
  it("reports a dry-run port with skips", () => {
    expect(summarizeSizeSetBackfill(true, 100, 21, 0, 79, 0)).toBe(
      "Would port custom_sizes → size_sets on 21 design(s) (scanned 100); 79 no convertible custom_sizes"
    )
  })

  it("reports a no-op sweep", () => {
    expect(summarizeSizeSetBackfill(false, 50, 0, 50, 0, 0)).toBe(
      "No changes — scanned 50 design(s), none needed a size_sets backfill; 50 already had size_sets"
    )
  })

  it("appends an error count", () => {
    expect(summarizeSizeSetBackfill(false, 10, 3, 5, 2, 1)).toContain(
      "1 error(s)"
    )
  })
})
