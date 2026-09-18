import {
  planInventoryOrderReceipt,
  postingsFromPlannedLines,
  outstandingOn,
  RECEIVABLE_STATUSES,
  type ReceiptOrderLine,
} from "../lib/plan-inventory-order-receipt"

/**
 * The receipt rule. Pure: no container, no DB.
 *
 * The case that produced it: 2 Mill Spun Pashminas, ₹14,000, physically in
 * Kiyo Designs' hands since 2026-09-17 with an OTP-verified Shiprocket scan and
 * GPS at her door — and `stocked_quantity: 0`, `updated_at` still the second the
 * ORDER was created nine days earlier. Nothing errored. Two triggers, only one
 * fired, and the receipt door was closed by the very status the carrier set.
 */
describe("planInventoryOrderReceipt", () => {
  const KIYO = "sloc_kiyo"
  const PASHMINA = "iitem_pashmina"

  const line = (over: Partial<ReceiptOrderLine> = {}): ReceiptOrderLine => ({
    id: "line_1",
    quantity: 2,
    received: 0,
    inventory_item_id: PASHMINA,
    ...over,
  })

  const plan = (over: Partial<Parameters<typeof planInventoryOrderReceipt>[0]> = {}) =>
    planInventoryOrderReceipt({
      order_id: "inv_order_1",
      status: "Delivered",
      destination_location_id: KIYO,
      lines: [line()],
      ...over,
    })

  it("🔴 receives an order the CARRIER marked Delivered — the case that was impossible", () => {
    const result = plan()
    expect(result).toEqual({
      ok: true,
      destination_location_id: KIYO,
      lines: [
        {
          order_line_id: "line_1",
          quantity: 2,
          inventory_item_id: PASHMINA,
          location_id: KIYO,
        },
      ],
    })
  })

  it("posts to the ORDER's destination, which on a consignment order is the partner's location", () => {
    const result = plan()
    expect(result.ok && result.lines[0].location_id).toBe(KIYO)
  })

  it("receives everything outstanding when no lines are given", () => {
    const result = plan({
      lines: [line({ id: "a", quantity: 5, received: 2 }), line({ id: "b", quantity: 3 })],
    })
    expect(result.ok && result.lines.map((l) => [l.order_line_id, l.quantity])).toEqual([
      ["a", 3],
      ["b", 3],
    ])
  })

  it("honours an explicit partial receipt", () => {
    const result = plan({ requested: [{ order_line_id: "line_1", quantity: 1 }] })
    expect(result.ok && result.lines[0].quantity).toBe(1)
  })

  it("🔴 refuses a second full receipt, so goods cannot be posted twice", () => {
    const result = plan({ lines: [line({ received: 2 })] })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain("already fully received")
  })

  it("🔴 refuses an over-receipt against what is outstanding", () => {
    const result = plan({
      lines: [line({ quantity: 2, received: 1 })],
      requested: [{ order_line_id: "line_1", quantity: 2 }],
    })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain("1 outstanding but 2 claimed")
  })

  it("tolerates decimal-metre rounding rather than calling 4.5 an over-receipt", () => {
    const result = plan({
      lines: [line({ quantity: 4.5 })],
      requested: [{ order_line_id: "line_1", quantity: 4.505 }],
    })
    expect(result.ok).toBe(true)
  })

  it("refuses a receipt before the goods have left the supplier", () => {
    const result = plan({ status: "Pending" })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain("cannot be received from status 'Pending'")
  })

  it("refuses a cancelled order", () => {
    const result = plan({ status: "Cancelled" })
    expect(result.ok).toBe(false)
  })

  it("accepts every status where goods can plausibly be in hand", () => {
    for (const status of RECEIVABLE_STATUSES) {
      expect(plan({ status }).ok).toBe(true)
    }
  })

  it("refuses a line that belongs to another order", () => {
    const result = plan({ requested: [{ order_line_id: "line_other", quantity: 1 }] })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain("does not belong to order")
  })

  it("falls back to the item's own location when the order names no destination", () => {
    const result = plan({
      destination_location_id: null,
      lines: [line({ item_location_ids: ["sloc_dharamshala"] })],
    })
    expect(result.ok && result.lines[0].location_id).toBe("sloc_dharamshala")
  })

  it("refuses rather than guessing when nothing can place the goods", () => {
    const result = plan({
      destination_location_id: null,
      lines: [line({ item_location_ids: [] })],
    })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain("No destination stock location")
  })

  it("lets an explicit location_id override the order's destination", () => {
    const result = plan({ location_id: "sloc_override" })
    expect(result.ok && result.lines[0].location_id).toBe("sloc_override")
  })

  it("says so out loud when a named line has nothing to stock", () => {
    const result = plan({
      lines: [line({ inventory_item_id: null })],
      requested: [{ order_line_id: "line_1", quantity: 2 }],
    })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain("names no inventory item")
  })

  it("quietly skips an untracked line on a receive-everything call, but still receives the rest", () => {
    const result = plan({
      lines: [line({ id: "a", inventory_item_id: null }), line({ id: "b" })],
    })
    expect(result.ok && result.lines.map((l) => l.order_line_id)).toEqual(["b"])
  })

  it("drops a zero-quantity line instead of writing an empty receipt", () => {
    const result = plan({
      lines: [line({ id: "a" }), line({ id: "b" })],
      requested: [
        { order_line_id: "a", quantity: 0 },
        { order_line_id: "b", quantity: 1 },
      ],
    })
    expect(result.ok && result.lines.map((l) => l.order_line_id)).toEqual(["b"])
  })

  it("refuses a negative quantity", () => {
    const result = plan({ requested: [{ order_line_id: "line_1", quantity: -1 }] })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain("Invalid quantity")
  })
})

describe("outstandingOn", () => {
  it("never reports a negative outstanding on an over-received line", () => {
    expect(
      outstandingOn({ id: "l", quantity: 2, received: 3, inventory_item_id: "i" })
    ).toBe(0)
  })

  it("keeps decimal metres free of float noise", () => {
    expect(
      outstandingOn({ id: "l", quantity: 17.6, received: 2.15, inventory_item_id: "i" })
    ).toBe(15.45)
  })
})

describe("postingsFromPlannedLines", () => {
  /**
   * The batch-number case: one raw-material group ordered as N separately
   * priced lines of the SAME item. The level write is absolute, so two postings
   * against one level would silently keep only the last — half the cloth would
   * vanish on arrival.
   */
  it("🔴 adds two lines of the same material into ONE posting", () => {
    expect(
      postingsFromPlannedLines([
        { order_line_id: "a", quantity: 40, inventory_item_id: "i", location_id: "L" },
        { order_line_id: "b", quantity: 46, inventory_item_id: "i", location_id: "L" },
      ])
    ).toEqual([{ inventory_item_id: "i", location_id: "L", quantity: 86 }])
  })

  it("keeps the same material at two locations apart", () => {
    expect(
      postingsFromPlannedLines([
        { order_line_id: "a", quantity: 1, inventory_item_id: "i", location_id: "L1" },
        { order_line_id: "b", quantity: 2, inventory_item_id: "i", location_id: "L2" },
      ])
    ).toHaveLength(2)
  })
})
