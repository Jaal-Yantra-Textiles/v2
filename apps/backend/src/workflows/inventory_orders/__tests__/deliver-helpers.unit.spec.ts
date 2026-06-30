import {
  evaluateAdminStatusTransition,
  computeAdminDeliveryPosting,
} from "../lib/deliver-helpers"

describe("evaluateAdminStatusTransition (#778 M / C2 admin-half)", () => {
  it("allows field-only edits while Pending/Processing (no stock impact)", () => {
    expect(evaluateAdminStatusTransition("Pending", undefined)).toEqual({ postStock: false })
    expect(evaluateAdminStatusTransition("Processing", null)).toEqual({ postStock: false })
    // same-status writes are field edits too
    expect(evaluateAdminStatusTransition("Processing", "Processing")).toEqual({ postStock: false })
  })

  it("preserves the editor lock once the order has left Pending/Processing", () => {
    for (const s of ["Shipped", "Delivered", "Cancelled", "Partial"]) {
      expect(() => evaluateAdminStatusTransition(s, undefined)).toThrow(
        "Order can only be updated if status is 'Pending' or 'Processing'."
      )
      // even a status change is blocked from a locked state
      expect(() => evaluateAdminStatusTransition(s, "Delivered")).toThrow(/Pending' or 'Processing'/)
    }
  })

  it("flags stock posting only when transitioning to Delivered", () => {
    expect(evaluateAdminStatusTransition("Processing", "Delivered")).toEqual({ postStock: true })
    expect(evaluateAdminStatusTransition("Pending", "Delivered")).toEqual({ postStock: true })
  })

  it("does not post stock for other transitions out of Pending/Processing", () => {
    // These remain allowed (existing dual-write / unification flows drive them via PUT)
    expect(evaluateAdminStatusTransition("Pending", "Processing")).toEqual({ postStock: false })
    expect(evaluateAdminStatusTransition("Processing", "Shipped")).toEqual({ postStock: false })
    expect(evaluateAdminStatusTransition("Processing", "Cancelled")).toEqual({ postStock: false })
  })
})

describe("computeAdminDeliveryPosting (#778 C2 admin-half)", () => {
  const lineWithItem = (id: string, quantity: number, itemId: string, locId?: string) => ({
    id,
    quantity,
    inventory_items: [
      { id: itemId, stock_locations: locId ? [{ id: locId }] : [] },
    ],
  })

  it("posts the full ordered quantity at the order destination location when nothing delivered yet", () => {
    const { levels, deliveredRecords } = computeAdminDeliveryPosting(
      [lineWithItem("ol_1", 10, "iitem_1"), lineWithItem("ol_2", 5, "iitem_2")],
      [],
      "sloc_dest"
    )
    expect(levels).toEqual([
      { location_id: "sloc_dest", inventory_item_id: "iitem_1", stocked_quantity: 10 },
      { location_id: "sloc_dest", inventory_item_id: "iitem_2", stocked_quantity: 5 },
    ])
    expect(deliveredRecords).toEqual([
      { order_line_id: "ol_1", quantity: 10 },
      { order_line_id: "ol_2", quantity: 5 },
    ])
  })

  it("posts only the remaining quantity for a partially-delivered order (no double-post)", () => {
    const { levels, deliveredRecords } = computeAdminDeliveryPosting(
      [lineWithItem("ol_1", 10, "iitem_1")],
      [{ order_line_id: "ol_1", quantity: 4 }],
      "sloc_dest"
    )
    expect(levels).toEqual([
      { location_id: "sloc_dest", inventory_item_id: "iitem_1", stocked_quantity: 6 },
    ])
    expect(deliveredRecords).toEqual([{ order_line_id: "ol_1", quantity: 6 }])
  })

  it("skips lines already fully delivered", () => {
    const { levels, deliveredRecords } = computeAdminDeliveryPosting(
      [lineWithItem("ol_1", 10, "iitem_1")],
      [{ order_line_id: "ol_1", quantity: 10 }],
      "sloc_dest"
    )
    expect(levels).toEqual([])
    expect(deliveredRecords).toEqual([])
  })

  it("falls back to the inventory item's own first linked location when the order has none", () => {
    const { levels } = computeAdminDeliveryPosting(
      [lineWithItem("ol_1", 3, "iitem_1", "sloc_item")],
      [],
      null
    )
    expect(levels).toEqual([
      { location_id: "sloc_item", inventory_item_id: "iitem_1", stocked_quantity: 3 },
    ])
  })

  it("records a remainder even when no location resolves (so cancel can reverse), but posts no level", () => {
    const { levels, deliveredRecords } = computeAdminDeliveryPosting(
      [{ id: "ol_1", quantity: 7, inventory_items: [{ id: "iitem_1", stock_locations: [] }] }],
      [],
      null
    )
    expect(levels).toEqual([])
    expect(deliveredRecords).toEqual([{ order_line_id: "ol_1", quantity: 7 }])
  })
})
