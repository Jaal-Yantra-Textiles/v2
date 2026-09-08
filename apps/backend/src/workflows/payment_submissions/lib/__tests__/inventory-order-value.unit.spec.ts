import {
  describeInventoryOrderValue,
  valueInventoryOrderByReceipts,
} from "../inventory-order-value"

/**
 * The fixture is the REAL shape of `inv_order_01K36TE2WB5BQR1MS6KESXP7Q3` as
 * read from production on 2026-08-28 — ten lines, five of them with receipts,
 * `price` per unit, receipts as typed `line_fulfillments` deltas.
 *
 * 🔑 A fixture tidier than reality certifies the wrong code: the awkward parts
 * here are the point. Two deltas on one line (10 + 6), a fractional receipt
 * (10.5), a line ordered 80 with nothing delivered, and an order whose
 * `total_price` (88,885) is nowhere near what is owed (25,670).
 */
const PARTIAL_ORDER_LINES = [
  { id: "01K36TE34N", quantity: 4, price: 400, material_name: "Yellow cheque two by one", line_fulfillments: [] },
  { id: "01K36TE3C0", quantity: 4.5, price: 450, material_name: "Brown Black cheque", line_fulfillments: [] },
  { id: "01K36TE3KB", quantity: 5.5, price: 380, material_name: "Brown Dark Weft Line", line_fulfillments: [] },
  {
    id: "01K36TE3TR",
    quantity: 16,
    price: 400,
    material_name: "Double Black Stripes Cheque over White Fabric",
    line_fulfillments: [{ quantity_delta: 10 }, { quantity_delta: 6 }],
  },
  {
    id: "01K36TE425",
    quantity: 31,
    price: 430,
    material_name: "White & Black & Red cheque",
    line_fulfillments: [{ quantity_delta: 10 }],
  },
  { id: "01K36TE49K", quantity: 10.5, price: 400, material_name: "White & Indigo cheque", line_fulfillments: [] },
  {
    id: "01K36TE4GX",
    quantity: 22,
    price: 380,
    material_name: "Black & Red line  Cheque Over White Fabric",
    line_fulfillments: [{ quantity_delta: 10.5 }],
  },
  {
    id: "01K36TE4RB",
    quantity: 21,
    price: 380,
    material_name: " Single Black Cheque Line Over White Fabric",
    line_fulfillments: [{ quantity_delta: 21 }],
  },
  { id: "01K36TE4ZN", quantity: 80, price: 380, material_name: "Yellow cheque", line_fulfillments: [] },
  {
    id: "01K36TE56Y",
    quantity: 50,
    price: 250,
    material_name: "Kala cotton white",
    line_fulfillments: [{ quantity_delta: 12 }],
  },
]

describe("valueInventoryOrderByReceipts", () => {
  it("reproduces the hrhandloom partial order at 25,670", () => {
    const value = valueInventoryOrderByReceipts(PARTIAL_ORDER_LINES)

    expect(value.total).toBe(25670)
    expect(value.received_quantity).toBe(69.5)
  })

  it("bills the ORDERED total on no line — 88,885 is not what is owed", () => {
    const value = valueInventoryOrderByReceipts(PARTIAL_ORDER_LINES)

    // The trap this helper exists to avoid: `total_price` overpays by 63,215.
    expect(value.total).not.toBe(88885)
  })

  it("sums multiple deltas on one line rather than taking the latest", () => {
    const value = valueInventoryOrderByReceipts(PARTIAL_ORDER_LINES)
    const doubleLine = value.lines.find((l) => l.line_id === "01K36TE3TR")

    // 10 + 6 = 16 received, at 400/unit. Taking the latest delta would bill
    // 6 x 400 = 2,400 and underpay by 4,000.
    expect(doubleLine?.received).toBe(16)
    expect(doubleLine?.amount).toBe(6400)
  })

  it("treats price as PER UNIT, not as the line total", () => {
    const value = valueInventoryOrderByReceipts(PARTIAL_ORDER_LINES)
    const singleLine = value.lines.find((l) => l.line_id === "01K36TE4RB")

    // 21 x 380. Reading `price` as the line total would bill 380.
    expect(singleLine?.amount).toBe(7980)
  })

  /**
   * Every other fixture in this file has NO `extra_cost`, which is exactly why
   * the whole suite stayed green while a payout was computed from `price`
   * alone. A fixture that cannot carry the charge cannot see it go missing.
   */
  describe("extra_cost — the per-unit colour/finishing charge is owed too", () => {
    it("bills (price + extra_cost) per received unit, not price alone", () => {
      const value = valueInventoryOrderByReceipts([
        {
          id: "l1",
          quantity: 12,
          price: 255,
          extra_cost: 120,
          line_fulfillments: [{ quantity_delta: 12 }],
        },
      ])

      // 12 x (255 + 120). Pricing from `price` alone bills 3,060 — short by 1,440.
      expect(value.lines[0]?.unit_price).toBe(375)
      expect(value.lines[0]?.amount).toBe(4500)
      expect(value.total).toBe(4500)
    })

    it("reproduces the GOF Asia order: 73 m of dyed cloth is 65,800, not 57,760", () => {
      const gof = [
        { id: "muslin100", quantity: 12, price: 255, extra_cost: 120 },
        { id: "muslin150", quantity: 12, price: 285, extra_cost: 120 },
        { id: "matka", quantity: 11, price: 1460, extra_cost: 120 },
        { id: "mulberryDT", quantity: 13, price: 690, extra_cost: 120 },
        { id: "mulberry3PLY", quantity: 13, price: 1230, extra_cost: 120 },
        { id: "linen60", quantity: 12, price: 795, extra_cost: 120 },
      ].map((l) => ({ ...l, line_fulfillments: [{ quantity_delta: l.quantity }] }))

      // Dropping extra_cost bills 57,760 — 8,040 of dye work unpaid on one order.
      expect(valueInventoryOrderByReceipts(gof).total).toBe(65800)
    })

    it("charges extra_cost only on what was RECEIVED, not on what was ordered", () => {
      const value = valueInventoryOrderByReceipts([
        {
          id: "l1",
          quantity: 20,
          price: 100,
          extra_cost: 50,
          line_fulfillments: [{ quantity_delta: 8 }],
        },
      ])

      // 8 x 150, never 20 x 150. A short delivery owes the dye it actually did.
      expect(value.total).toBe(1200)
      expect(value.received_quantity).toBe(8)
    })

    it("treats a null or absent extra_cost as zero rather than NaN", () => {
      const value = valueInventoryOrderByReceipts([
        { id: "l1", quantity: 5, price: 100, extra_cost: null, line_fulfillments: [{ quantity_delta: 5 }] },
        { id: "l2", quantity: 5, price: 100, line_fulfillments: [{ quantity_delta: 5 }] },
      ])

      expect(value.total).toBe(1000)
      expect(value.lines.every((l) => Number.isFinite(l.amount))).toBe(true)
    })

    it("bills a line whose whole value is the colour job", () => {
      const value = valueInventoryOrderByReceipts([
        { id: "l1", quantity: 10, price: 0, extra_cost: 80, line_fulfillments: [{ quantity_delta: 10 }] },
      ])

      // price 0 is not "no line" — dyeing customer-supplied cloth is real work.
      // A `price > 0` guard anywhere in this path would pay 0 for it.
      expect(value.total).toBe(800)
    })
  })

  it("drops lines with no receipt instead of billing them at zero", () => {
    const value = valueInventoryOrderByReceipts(PARTIAL_ORDER_LINES)

    expect(value.lines).toHaveLength(5)
    expect(value.lines.map((l) => l.line_id)).not.toContain("01K36TE4ZN")
  })

  it("handles a fractional receipt without a floating-point tail", () => {
    const value = valueInventoryOrderByReceipts([
      { id: "l1", quantity: 22, price: 380, line_fulfillments: [{ quantity_delta: 10.4 }, { quantity_delta: 10.5 }] },
    ])

    expect(value.lines[0].received).toBe(20.9)
    expect(value.lines[0].amount).toBe(7942)
  })

  it("lets a negative delta reduce what is owed", () => {
    // `adjust` / `correction` events are real, and a correction that removes
    // goods must remove the money with it.
    const value = valueInventoryOrderByReceipts([
      { id: "l1", quantity: 10, price: 100, line_fulfillments: [{ quantity_delta: 10 }, { quantity_delta: -4 }] },
    ])

    expect(value.lines[0].received).toBe(6)
    expect(value.total).toBe(600)
  })

  it("values the delivered order at its full ordered price", () => {
    // inv_order_01KXZP0DFD… — 10 units of Dusty Rose at 300, fully received.
    const value = valueInventoryOrderByReceipts([
      {
        id: "01KXZP0DFE",
        quantity: 10,
        price: 300,
        material_name: "Organic Kala Cotton — Dusty Rose",
        line_fulfillments: [{ quantity_delta: 10 }],
      },
    ])

    expect(value.total).toBe(3000)
  })

  it("returns zero for an order with no receipts at all", () => {
    const value = valueInventoryOrderByReceipts([
      { id: "l1", quantity: 5, price: 100, line_fulfillments: [] },
    ])

    expect(value.total).toBe(0)
    expect(value.lines).toHaveLength(0)
  })

  it("tolerates null fulfillments and null price", () => {
    const value = valueInventoryOrderByReceipts([
      { id: "l1", quantity: 5, price: null, line_fulfillments: null },
      { id: "l2", quantity: 5, price: null, line_fulfillments: [{ quantity_delta: 3 }] },
    ])

    expect(value.total).toBe(0)
    expect(value.lines).toHaveLength(1)
  })
})

describe("describeInventoryOrderValue", () => {
  it("reads as something a partner can check against their delivery notes", () => {
    const value = valueInventoryOrderByReceipts([
      {
        id: "01K36TE4RB",
        quantity: 21,
        price: 380,
        material_name: "Single Black Cheque Line Over White Fabric",
        line_fulfillments: [{ quantity_delta: 21 }],
      },
    ])

    expect(describeInventoryOrderValue(value)).toBe(
      "Single Black Cheque Line Over White Fabric: 21 x 380 = 7980"
    )
  })
})
