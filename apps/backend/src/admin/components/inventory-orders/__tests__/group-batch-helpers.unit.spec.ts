import {
  expandGroupsToBatchLines,
  summarizeExpansion,
  type GroupForExpansion,
} from "../group-batch-helpers"

const group = (
  name: string,
  colors: Array<string | null>,
  extra: Partial<GroupForExpansion> = {}
): GroupForExpansion => ({
  name,
  raw_materials: colors.map((id) =>
    id ? { inventory_item: { id } } : { inventory_item: null }
  ),
  ...extra,
})

describe("expandGroupsToBatchLines", () => {
  it("summed mode: one line per color, quantity = MOQ × batches", () => {
    const { lines, summary } = expandGroupsToBatchLines({
      groups: [group("Cotton", ["ii_1", "ii_2"], { minimum_order_quantity: 50, unit_cost: 7 })],
      existingItemIds: [],
      batches: 4,
      keepSeparate: false,
    })
    expect(lines).toHaveLength(2)
    expect(lines[0]).toEqual({ inventory_item_id: "ii_1", quantity: 200, price: 7, batch_number: null })
    expect(summary.added).toBe(2)
    expect(summary.batches).toBe(4)
  })

  it("separate mode: N lines per color tagged 1..N", () => {
    const { lines, summary } = expandGroupsToBatchLines({
      groups: [group("Cotton", ["ii_1"], { minimum_order_quantity: 50 })],
      existingItemIds: [],
      batches: 3,
      keepSeparate: true,
    })
    expect(lines).toHaveLength(3)
    expect(lines.map((l) => l.batch_number)).toEqual([1, 2, 3])
    expect(lines.every((l) => l.quantity === 50)).toBe(true)
    expect(summary.colors).toBe(1)
    expect(summary.added).toBe(3)
  })

  it("summed mode skips colors already in the order; separate mode does not", () => {
    const summed = expandGroupsToBatchLines({
      groups: [group("Cotton", ["ii_1", "ii_2"])],
      existingItemIds: ["ii_1"],
      batches: 1,
      keepSeparate: false,
    })
    expect(summed.lines.map((l) => l.inventory_item_id)).toEqual(["ii_2"])
    expect(summed.summary.skippedDuplicate).toBe(1)

    const separate = expandGroupsToBatchLines({
      groups: [group("Cotton", ["ii_1"])],
      existingItemIds: ["ii_1"],
      batches: 2,
      keepSeparate: true,
    })
    expect(separate.lines).toHaveLength(2)
    expect(separate.summary.skippedDuplicate).toBe(0)
  })

  it("dedupes the same color across multiple selected groups (summed)", () => {
    const { lines, summary } = expandGroupsToBatchLines({
      groups: [group("A", ["ii_1"]), group("B", ["ii_1", "ii_2"])],
      existingItemIds: [],
      batches: 1,
      keepSeparate: false,
    })
    expect(lines.map((l) => l.inventory_item_id).sort()).toEqual(["ii_1", "ii_2"])
    expect(summary.skippedDuplicate).toBe(1)
  })

  it("counts colors without a stock item as skipped, never emits them", () => {
    const { lines, summary } = expandGroupsToBatchLines({
      groups: [group("A", ["ii_1", null, null])],
      existingItemIds: [],
      batches: 1,
      keepSeparate: false,
    })
    expect(lines).toHaveLength(1)
    expect(summary.skippedNoItem).toBe(2)
  })

  it("defaults MOQ→1 and unit_cost→0 when unset, and clamps batches to >= 1", () => {
    const { lines } = expandGroupsToBatchLines({
      groups: [group("A", ["ii_1"])],
      existingItemIds: [],
      batches: 0,
      keepSeparate: false,
    })
    expect(lines[0]).toEqual({ inventory_item_id: "ii_1", quantity: 1, price: 0, batch_number: null })
  })
})

describe("summarizeExpansion", () => {
  it("describes separate-batch adds", () => {
    const s = { added: 6, colors: 2, skippedDuplicate: 0, skippedNoItem: 1, batches: 3, keepSeparate: true }
    const msg = summarizeExpansion(s, 1)
    expect(msg).toContain("6 lines")
    expect(msg).toContain("2 colors × 3 batches")
    expect(msg).toContain("1 without a stock item")
  })

  it("describes summed adds", () => {
    const s = { added: 2, colors: 2, skippedDuplicate: 1, skippedNoItem: 0, batches: 4, keepSeparate: false }
    const msg = summarizeExpansion(s, 2)
    expect(msg).toContain("2 colors from 2 groups")
    expect(msg).toContain("×4 batches summed")
    expect(msg).toContain("1 already in the order")
  })
})
