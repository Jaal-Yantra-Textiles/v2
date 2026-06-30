import {
  buildOrderLinePayloads,
  buildInventoryLineLinkPairs,
  sumLineTotals,
} from "../lib/create-helpers"

describe("sumLineTotals (#778 H9 — price is per-unit)", () => {
  it("sums price × quantity per line", () => {
    expect(
      sumLineTotals([
        { price: 4.5, quantity: 200 },
        { price: 1.25, quantity: 50 },
      ])
    ).toBeCloseTo(962.5)
  })

  it("does NOT treat price as a line total (the old bug)", () => {
    // 10 units @ 8 each = 80, not 8.
    expect(sumLineTotals([{ price: 8, quantity: 10 }])).toBe(80)
  })

  it("treats missing/NaN price or quantity as 0", () => {
    expect(
      sumLineTotals([
        { price: NaN as any, quantity: 5 },
        { price: 3, quantity: undefined as any },
      ])
    ).toBe(0)
  })

  it("is 0 for no lines", () => {
    expect(sumLineTotals([])).toBe(0)
  })
})

describe("buildOrderLinePayloads (#778 C3)", () => {
  it("maps each input line to a persistence payload bound to the order id", () => {
    const payloads = buildOrderLinePayloads(
      [
        { inventory_id: "iitem_1", quantity: 10, price: 50, metadata: { sku: "A" } },
        { inventory_id: "iitem_2", quantity: 4, price: 100 },
      ],
      "invord_1"
    )
    expect(payloads).toEqual([
      { quantity: 10, price: 50, metadata: { sku: "A" }, inventory_orders: "invord_1" },
      { quantity: 4, price: 100, metadata: null, inventory_orders: "invord_1" },
    ])
  })

  it("does NOT carry inventory_id onto the payload (no such column on the line)", () => {
    const [payload] = buildOrderLinePayloads(
      [{ inventory_id: "iitem_1", quantity: 1, price: 1 }],
      "invord_1"
    )
    expect(payload).not.toHaveProperty("inventory_id")
  })
})

describe("buildInventoryLineLinkPairs (#778 C3)", () => {
  const order_lines = [
    { inventory_id: "iitem_1", quantity: 10, price: 50 },
    { inventory_id: "iitem_2", quantity: 4, price: 100 },
    { inventory_id: "iitem_3", quantity: 2, price: 25 },
  ]

  it("pairs each created line to the inventory item at the same position", () => {
    const created = [{ id: "ol_1" }, { id: "ol_2" }, { id: "ol_3" }]
    expect(buildInventoryLineLinkPairs(created, order_lines)).toEqual([
      { order_line_id: "ol_1", inventory_item_id: "iitem_1" },
      { order_line_id: "ol_2", inventory_item_id: "iitem_2" },
      { order_line_id: "ol_3", inventory_item_id: "iitem_3" },
    ])
  })

  it("throws on a length mismatch instead of silently mis-pairing (the old index-zip bug)", () => {
    // A short created-lines array (what partial success used to produce) must
    // NOT quietly shift item 2 onto line 3 — it must fail loudly.
    expect(() =>
      buildInventoryLineLinkPairs([{ id: "ol_1" }, { id: "ol_3" }], order_lines)
    ).toThrow(/line count mismatch/i)
  })

  it("handles the empty case as an empty pairing", () => {
    expect(buildInventoryLineLinkPairs([], [])).toEqual([])
  })
})
