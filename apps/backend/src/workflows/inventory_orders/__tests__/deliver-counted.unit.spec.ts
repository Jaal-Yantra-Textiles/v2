import { computeAdminDeliveryPosting, requireDeliveryCounts } from "../lib/deliver-helpers"

/**
 * #2289 S2 (founder decision 2026-10-08, option b) — an admin marking an order
 * Delivered posts what was COUNTED, never "everything outstanding arrived".
 */
describe("admin Delivered posts counted quantities only", () => {
  const line = (id: string, quantity: number, itemId: string) => ({
    id,
    quantity,
    inventory_items: [{ id: itemId, stock_locations: [] }],
  })

  it("refuses a Delivered update that carries no counts", () => {
    expect(() => requireDeliveryCounts(true, undefined)).toThrow(/counted quantities/)
  })

  it("needs no counts when the update posts nothing", () => {
    expect(requireDeliveryCounts(false, undefined)).toBeNull()
  })

  it("sums counts per line", () => {
    expect(
      requireDeliveryCounts(true, [
        { order_line_id: "ol_1", quantity: 2 },
        { order_line_id: "ol_1", quantity: 0.5 },
      ])
    ).toEqual({ ol_1: 2.5 })
  })

  it("posts the count, not the remainder; a line left out posts nothing", () => {
    const { levels, deliveredRecords } = computeAdminDeliveryPosting(
      [line("ol_1", 3, "iitem_1"), line("ol_2", 5, "iitem_2")],
      [],
      "sloc_dest",
      { ol_1: 2 }
    )
    expect(levels).toEqual([{ location_id: "sloc_dest", inventory_item_id: "iitem_1", stocked_quantity: 2 }])
    expect(deliveredRecords).toEqual([{ order_line_id: "ol_1", quantity: 2 }])
  })

  it("refuses a count above what is still outstanding", () => {
    expect(() =>
      computeAdminDeliveryPosting([line("ol_1", 3, "iitem_1")], [], "sloc_dest", { ol_1: 4 })
    ).toThrow(/only 3 is still outstanding/)
  })

  it("refuses a negative count", () => {
    expect(() =>
      computeAdminDeliveryPosting([line("ol_1", 3, "iitem_1")], [], "sloc_dest", { ol_1: -1 })
    ).toThrow(/negative/)
  })
})
