import { describe, expect, it } from "vitest"

import { splitThumbnails, summarizeBomLines } from "../work-order-header"

describe("splitThumbnails", () => {
  const media = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${i}` }))

  it("shows everything and claims no overflow when it fits", () => {
    expect(splitThumbnails(media(3), 5)).toEqual({
      shown: media(3),
      overflow: 0,
    })
  })

  /**
   * 🔴 overflow is the REMAINDER, not the total. "+9" beside 5 visible
   * thumbnails on a 9-image design is the obvious off-by-one, and it reads as
   * plausible — which is exactly what would let it survive review.
   */
  it("reports only the ones it did not show", () => {
    const { shown, overflow } = splitThumbnails(media(9), 5)
    expect(shown).toHaveLength(5)
    expect(overflow).toBe(4)
  })

  it("is exact at the boundary", () => {
    expect(splitThumbnails(media(5), 5).overflow).toBe(0)
    expect(splitThumbnails(media(6), 5).overflow).toBe(1)
  })

  it("handles nothing, null and undefined alike", () => {
    for (const v of [[], null, undefined]) {
      expect(splitThumbnails(v as any, 5)).toEqual({ shown: [], overflow: 0 })
    }
  })

  it("treats a non-positive max as 'show none, all overflow'", () => {
    expect(splitThumbnails(media(3), 0)).toEqual({ shown: [], overflow: 3 })
  })
})

describe("summarizeBomLines", () => {
  it("counts an empty BOM as zero across the board", () => {
    expect(summarizeBomLines([])).toEqual({
      materialCount: 0,
      plannedCount: 0,
      consumedCount: 0,
    })
    expect(summarizeBomLines(null).materialCount).toBe(0)
  })

  it("counts lines, planned lines and consumed lines separately", () => {
    expect(
      summarizeBomLines([
        { planned_quantity: 10, consumed_quantity: 4 },
        { planned_quantity: 5 },
        {},
      ])
    ).toEqual({ materialCount: 3, plannedCount: 2, consumedCount: 1 })
  })

  /**
   * 🔴 `Number(null)` is 0 and `0` is not `null`. A `!= null` guard would
   * count every unplanned line as planned; a truthiness check on a legitimate
   * 0 would drop it. Both directions pinned.
   */
  it("does not count a planned quantity of 0, or a null one", () => {
    expect(
      summarizeBomLines([
        { planned_quantity: 0 },
        { planned_quantity: null },
        { planned_quantity: undefined },
      ]).plannedCount
    ).toBe(0)
  })

  it("counts a fractional planned quantity — cloth is metres", () => {
    expect(summarizeBomLines([{ planned_quantity: 0.5 }]).plannedCount).toBe(1)
  })

  it("survives junk rows without dropping the material count", () => {
    expect(summarizeBomLines([null, "x", { planned_quantity: 2 }] as any)).toEqual(
      { materialCount: 3, plannedCount: 1, consumedCount: 0 }
    )
  })
})
