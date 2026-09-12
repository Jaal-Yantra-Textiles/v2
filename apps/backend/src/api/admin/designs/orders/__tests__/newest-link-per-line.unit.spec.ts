import { newestLinkPerLine } from "../newest-link-per-line"

/**
 * The `sibling_items[0]` red on main.
 *
 * It was recorded as an ordering quirk in the test — `listLineItems` having no
 * ORDER BY. It is not. `repointOrderItemDesign` dismisses the old design link
 * and creates the new one as two separate writes, so the link table can hold
 * two rows for one line. Everything downstream assumed one:
 *
 * · `resolveLineItemDesignId` did `take: 1` with no order — so the CANONICAL
 *   resolver, which every run-creation path reads, returned the design the
 *   customer is no longer getting about half the time;
 * · this page built one `sibling_items` entry per row — two rows, two siblings
 *   for a single garment.
 *
 * Same family as #1983's `take:1` and #1979's `stores[0]`: a selector that
 * decides real output from row order.
 */

const row = (line: string, design: string, created_at?: string | null) => ({
  line_item_id: line,
  design_id: design,
  ...(created_at === undefined ? {} : { created_at }),
})

describe("newestLinkPerLine", () => {
  it("keeps the newest row for a line, whichever order they arrive in", () => {
    const old = row("li_B", "designB", "2026-09-01T00:00:00Z")
    const fresh = row("li_B", "designD", "2026-09-12T00:00:00Z")

    // 🔑 Both orderings must give the same answer — that is the entire point.
    expect(newestLinkPerLine([old, fresh])).toEqual([fresh])
    expect(newestLinkPerLine([fresh, old])).toEqual([fresh])
  })

  it("returns ONE row per line, so one garment is one sibling", () => {
    const out = newestLinkPerLine([
      row("li_A", "designA", "2026-09-01T00:00:00Z"),
      row("li_B", "designB", "2026-09-01T00:00:00Z"),
      row("li_B", "designD", "2026-09-12T00:00:00Z"),
    ])
    expect(out).toHaveLength(2)
    expect(out.map((r) => r.line_item_id).sort()).toEqual(["li_A", "li_B"])
    expect(out.find((r) => r.line_item_id === "li_B")?.design_id).toBe("designD")
  })

  it("never lets a row with no date displace one that has a date", () => {
    // An unknown `created_at` is not evidence of being newer. Treating it as
    // newest would reinstate the lottery through the back door.
    const dated = row("li_B", "designD", "2026-09-12T00:00:00Z")
    const undatedNull = row("li_B", "designB", null)
    const undatedMissing = row("li_B", "designB")

    expect(newestLinkPerLine([dated, undatedNull])).toEqual([dated])
    expect(newestLinkPerLine([undatedNull, dated])).toEqual([dated])
    expect(newestLinkPerLine([dated, undatedMissing])).toEqual([dated])
    expect(newestLinkPerLine([undatedMissing, dated])).toEqual([dated])
  })

  it("is stable between two undated rows rather than arrival-order dependent", () => {
    const a = row("li_B", "designB", null)
    const b = row("li_B", "designD", null)
    expect(newestLinkPerLine([a, b])).toEqual([a])
    expect(newestLinkPerLine([b, a])).toEqual([b])
  })

  it("ignores an unparseable date rather than treating it as epoch 0", () => {
    const good = row("li_B", "designD", "2026-09-12T00:00:00Z")
    const garbage = row("li_B", "designB", "not-a-date")
    expect(newestLinkPerLine([good, garbage])).toEqual([good])
    expect(newestLinkPerLine([garbage, good])).toEqual([good])
  })

  it("handles no rows and skips rows with no line id", () => {
    expect(newestLinkPerLine([])).toEqual([])
    expect(newestLinkPerLine(null)).toEqual([])
    expect(newestLinkPerLine(undefined)).toEqual([])
    expect(newestLinkPerLine([{ line_item_id: "", design_id: "x" }])).toEqual([])
  })
})
