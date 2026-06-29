import {
  assertCancellable,
  aggregateDeliveredByLine,
  buildReversalLevels,
  computeStockReversalUpdates,
  selectOpenTaskIds,
} from "../lib/cancel-helpers"

describe("assertCancellable (#778 C4)", () => {
  it("allows cancelling from any non-terminal status", () => {
    for (const s of ["Pending", "Processing", "Shipped", "Partial", "Delivered"]) {
      expect(() => assertCancellable(s)).not.toThrow()
    }
  })

  it("rejects re-cancelling an already-Cancelled order", () => {
    expect(() => assertCancellable("Cancelled")).toThrow(/cannot be cancelled/i)
  })

  it("rejects a missing/unknown status", () => {
    expect(() => assertCancellable(null)).toThrow(/cannot be cancelled/i)
    expect(() => assertCancellable(undefined)).toThrow(/cannot be cancelled/i)
  })
})

describe("aggregateDeliveredByLine (#778 C2)", () => {
  it("sums quantities per line and drops non-positive / malformed entries", () => {
    expect(
      aggregateDeliveredByLine([
        { order_line_id: "ol_1", quantity: 3 },
        { order_line_id: "ol_1", quantity: 2 },
        { order_line_id: "ol_2", quantity: 4 },
        { order_line_id: "ol_3", quantity: 0 },
        { order_line_id: "", quantity: 5 } as any,
      ])
    ).toEqual({ ol_1: 5, ol_2: 4 })
  })

  it("handles empty / nullish input", () => {
    expect(aggregateDeliveredByLine([])).toEqual({})
    expect(aggregateDeliveredByLine(null)).toEqual({})
  })
})

describe("buildReversalLevels (#778 C2)", () => {
  const orderlines = [
    { id: "ol_1", inventory_items: [{ id: "iitem_1", stock_locations: [{ id: "sloc_item" }] }] },
    { id: "ol_2", inventory_items: [{ id: "iitem_2", stock_locations: [] }] },
  ]

  it("maps delivered lines to (item, dest-location, qty) at the order destination", () => {
    const levels = buildReversalLevels(
      orderlines,
      [{ order_line_id: "ol_1", quantity: 6 }, { order_line_id: "ol_2", quantity: 4 }],
      "sloc_dest"
    )
    expect(levels).toEqual([
      { location_id: "sloc_dest", inventory_item_id: "iitem_1", quantity: 6 },
      { location_id: "sloc_dest", inventory_item_id: "iitem_2", quantity: 4 },
    ])
  })

  it("falls back to the item's own first location when no destination is given", () => {
    const levels = buildReversalLevels(orderlines, [{ order_line_id: "ol_1", quantity: 6 }], null)
    expect(levels).toEqual([
      { location_id: "sloc_item", inventory_item_id: "iitem_1", quantity: 6 },
    ])
  })

  it("skips lines with no delivered qty, no item, or no resolvable location", () => {
    // ol_2 has no item location and no destination → skipped; undelivered → skipped
    expect(buildReversalLevels(orderlines, [{ order_line_id: "ol_2", quantity: 4 }], null)).toEqual([])
    expect(buildReversalLevels(orderlines, [], "sloc_dest")).toEqual([])
  })
})

describe("computeStockReversalUpdates (#778 C2)", () => {
  it("subtracts reversal qty from the matching existing level", () => {
    const updates = computeStockReversalUpdates(
      [{ location_id: "L", inventory_item_id: "I", quantity: 4 }],
      [{ id: "lvl_1", location_id: "L", inventory_item_id: "I", stocked_quantity: 10 }]
    )
    expect(updates).toEqual([
      { id: "lvl_1", inventory_item_id: "I", location_id: "L", stocked_quantity: 6 },
    ])
  })

  it("floors at 0 — never drives stock negative", () => {
    const updates = computeStockReversalUpdates(
      [{ location_id: "L", inventory_item_id: "I", quantity: 99 }],
      [{ id: "lvl_1", location_id: "L", inventory_item_id: "I", stocked_quantity: 10 }]
    )
    expect(updates[0].stocked_quantity).toBe(0)
  })

  it("sums duplicate (item,location) reversals before subtracting", () => {
    const updates = computeStockReversalUpdates(
      [
        { location_id: "L", inventory_item_id: "I", quantity: 3 },
        { location_id: "L", inventory_item_id: "I", quantity: 2 },
      ],
      [{ id: "lvl_1", location_id: "L", inventory_item_id: "I", stocked_quantity: 10 }]
    )
    expect(updates[0].stocked_quantity).toBe(5)
  })

  it("skips reversals with no matching existing level (nothing posted to take back)", () => {
    expect(
      computeStockReversalUpdates(
        [{ location_id: "L", inventory_item_id: "I", quantity: 4 }],
        [{ id: "lvl_2", location_id: "OTHER", inventory_item_id: "I", stocked_quantity: 10 }]
      )
    ).toEqual([])
  })
})

describe("selectOpenTaskIds (#778 C4)", () => {
  it("selects only still-open tasks, leaving terminal ones alone", () => {
    expect(
      selectOpenTaskIds([
        { id: "t1", status: "pending" },
        { id: "t2", status: "in_progress" },
        { id: "t3", status: "assigned" },
        { id: "t4", status: "accepted" },
        { id: "t5", status: "completed" },
        { id: "t6", status: "cancelled" },
        { id: undefined, status: "pending" },
        null,
      ] as any)
    ).toEqual(["t1", "t2", "t3", "t4"])
  })
})
