import {
  blobHasContent,
  summarizeBackfill,
} from "../audit-moodboard-backfill-job"

/**
 * #2017 — the job exists to produce a NUMBER the deploy log cannot give.
 * These pin the two places the number could lie.
 */
describe("blobHasContent", () => {
  it("is true for a board with elements", () => {
    expect(blobHasContent({ elements: [{ type: "frame" }] })).toBe(true)
  })

  /**
   * 🔴 The SAME rule the migration uses. A board that is `{}` or has an empty
   * elements array is one nobody started — minting a core row for it turns
   * "never started" into "started and blank" across the whole table. If this
   * ever diverges from the migration, the job reports a gap that is not real
   * and then repairs it into existence.
   */
  it.each([{}, { elements: [] }, { elements: null }])(
    "is false for the empty board %p",
    (blob) => {
      expect(blobHasContent(blob)).toBe(false)
    }
  )

  it("is false for anything that is not an object", () => {
    for (const v of [null, undefined, "x", 7, [{ type: "frame" }]]) {
      expect(blobHasContent(v)).toBe(false)
    }
  })
})

describe("summarizeBackfill", () => {
  it("says the backfill is complete when nothing is missing", () => {
    const msg = summarizeBackfill(true, 21, 21, 0)
    expect(msg).toContain("21 designs carry a legacy moodboard")
    expect(msg).toContain("21 have a core board row")
    expect(msg).toContain("the backfill is complete")
  })

  /**
   * The counts are reported even when there IS a gap — "3 missing" alone
   * cannot be judged without knowing 3 of how many.
   */
  it("reports the counts alongside the gap", () => {
    const msg = summarizeBackfill(true, 21, 18, 3)
    expect(msg).toContain("21 designs")
    expect(msg).toContain("18 have a core board row")
    expect(msg).toContain("Would create 3 missing core boards")
  })

  it("distinguishes a preview from an apply", () => {
    expect(summarizeBackfill(true, 5, 4, 1)).toContain("Would create 1")
    expect(summarizeBackfill(false, 5, 4, 1)).toContain("Created 1")
  })

  it("keeps the singular readable", () => {
    expect(summarizeBackfill(true, 1, 1, 0)).toContain("1 design carries")
  })
})
