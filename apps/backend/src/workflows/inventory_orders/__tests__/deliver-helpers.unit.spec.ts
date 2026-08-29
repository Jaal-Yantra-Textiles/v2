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

/**
 * #1613 — the admin deliver path posted `ordered − already`, where `already`
 * came from `metadata.partner_delivered_lines` alone. That key is OVERWRITTEN
 * by the partner path on every submission, so on production it under-counted by
 * 58.8 units across five orders — stock posted a second time for goods already
 * in the warehouse.
 *
 * These cases pin the merged read. Each one is written so it FAILS against the
 * blob-only helper: the fixtures put the typed and blob records in genuine
 * disagreement, in both directions, rather than agreeing at a number that would
 * make the assertion vacuous.
 */
describe("computeAdminDeliveryPosting reads both receipt records (#1613)", () => {
  const line = (
    id: string,
    quantity: number,
    itemId: string,
    typed: number[] = []
  ) => ({
    id,
    quantity,
    inventory_items: [{ id: itemId, stock_locations: [] }],
    line_fulfillments: typed.map((quantity_delta) => ({ quantity_delta })),
  })

  it("uses the typed receipts when the blob understates them", () => {
    // The partner submitted 10, then 6. The blob was overwritten and holds only
    // the 6; the typed rows hold both. Blob-only posts 14 of a 16-unit line —
    // 10 units of stock that is already on the shelf.
    const { levels, deliveredRecords } = computeAdminDeliveryPosting(
      [line("ol_1", 16, "iitem_1", [10, 6])],
      [{ order_line_id: "ol_1", quantity: 6 }],
      "sloc_dest"
    )
    expect(levels).toEqual([])
    expect(deliveredRecords).toEqual([])
  })

  it("keeps the blob when the TYPED side is the one missing an entry", () => {
    // `inv_order_01K3BAM50H…` in production: 62 units in the blob, zero typed
    // rows. Switching outright to the typed record would post the whole line
    // again — worse than the bug being fixed.
    const { levels } = computeAdminDeliveryPosting(
      [line("ol_1", 62, "iitem_1", [])],
      [{ order_line_id: "ol_1", quantity: 62 }],
      "sloc_dest"
    )
    expect(levels).toEqual([])
  })

  it("posts the genuine remainder when both records agree it is partial", () => {
    const { levels, deliveredRecords } = computeAdminDeliveryPosting(
      [line("ol_1", 31, "iitem_1", [10])],
      [{ order_line_id: "ol_1", quantity: 10 }],
      "sloc_dest"
    )
    expect(levels).toEqual([
      { location_id: "sloc_dest", inventory_item_id: "iitem_1", stocked_quantity: 21 },
    ])
    expect(deliveredRecords).toEqual([{ order_line_id: "ol_1", quantity: 21 }])
  })

  it("sums typed deltas rather than taking the largest row", () => {
    // A `correction` row is a negative delta and legitimately reduces the
    // total. Taking max-of-rows would read 12 here and post 8 too little.
    const { deliveredRecords } = computeAdminDeliveryPosting(
      [line("ol_1", 30, "iitem_1", [12, -2])],
      [],
      "sloc_dest"
    )
    expect(deliveredRecords).toEqual([{ order_line_id: "ol_1", quantity: 20 }])
  })

  it("treats the all-null placeholder row query.graph returns for an empty relation as zero receipts", () => {
    // ⚠️ `line_fulfillments.length === 1` does NOT mean one receipt: a line with
    // none comes back as a single row of nulls.
    const { deliveredRecords } = computeAdminDeliveryPosting(
      [
        {
          id: "ol_1",
          quantity: 9,
          inventory_items: [{ id: "iitem_1", stock_locations: [] }],
          line_fulfillments: [{ quantity_delta: null }],
        },
      ],
      [],
      "sloc_dest"
    )
    expect(deliveredRecords).toEqual([{ order_line_id: "ol_1", quantity: 9 }])
  })

  it("still behaves as before for lines carrying no typed record at all", () => {
    const { deliveredRecords } = computeAdminDeliveryPosting(
      [{ id: "ol_1", quantity: 10, inventory_items: [{ id: "iitem_1", stock_locations: [] }] }],
      [{ order_line_id: "ol_1", quantity: 4 }],
      "sloc_dest"
    )
    expect(deliveredRecords).toEqual([{ order_line_id: "ol_1", quantity: 6 }])
  })
})
