import { declaredValueForShipment } from "../declared-value"

/**
 * Order #83 shipped prepaid and showed as a ₹0 order on the Delhivery dashboard
 * because no declared value was ever sent. 0 is the one value that is certainly
 * wrong, so the fallbacks below matter as much as the happy path.
 */
describe("declaredValueForShipment", () => {
  const orderItems = (rows: any[]) =>
    new Map(rows.map((r) => [r.id, r]))

  it("sums the line totals of the items actually in the box", () => {
    const value = declaredValueForShipment({
      items: [
        { line_item_id: "li_1", quantity: 1 },
        { line_item_id: "li_2", quantity: 2 },
      ],
      orderItemById: orderItems([
        { id: "li_1", quantity: 1, total: 1200 },
        { id: "li_2", quantity: 2, total: 900 },
      ]),
    })
    expect(value).toBe(2100)
  })

  it("declares only this shipment's share of a partially fulfilled line", () => {
    // 4 ordered at 2000 total; only 1 is shipping.
    const value = declaredValueForShipment({
      items: [{ line_item_id: "li_1", quantity: 1 }],
      orderItemById: orderItems([{ id: "li_1", quantity: 4, total: 2000 }]),
    })
    expect(value).toBe(500)
  })

  it("falls back to unit_price when the line carries no total", () => {
    const value = declaredValueForShipment({
      items: [{ line_item_id: "li_1", quantity: 3 }],
      orderItemById: orderItems([{ id: "li_1", quantity: 3, unit_price: 250 }]),
    })
    expect(value).toBe(750)
  })

  it("reads BigNumber-ish money objects", () => {
    const value = declaredValueForShipment({
      items: [{ line_item_id: "li_1", quantity: 1 }],
      orderItemById: orderItems([
        { id: "li_1", quantity: 1, total: { value: "1499.5" } },
      ]),
    })
    expect(value).toBe(1499.5)
  })

  it("falls back to the order total when no line price resolves", () => {
    const value = declaredValueForShipment({
      items: [{ line_item_id: "li_missing", quantity: 1 }],
      orderItemById: orderItems([]),
      order: { item_total: 3300 },
    })
    expect(value).toBe(3300)
  })

  it("returns 0 rather than guessing when nothing is known", () => {
    expect(
      declaredValueForShipment({
        items: [{ line_item_id: "li_1", quantity: 1 }],
        orderItemById: orderItems([{ id: "li_1", quantity: 1 }]),
        order: null,
      })
    ).toBe(0)
  })

  it("is unaffected by cod_amount concerns — a prepaid box still has value", () => {
    // Regression guard for the actual defect: prepaid (cod 0) must not imply 0 value.
    const value = declaredValueForShipment({
      items: [{ line_item_id: "li_1", quantity: 1 }],
      orderItemById: orderItems([{ id: "li_1", quantity: 1, total: 4999 }]),
    })
    expect(value).toBeGreaterThan(0)
  })
})
