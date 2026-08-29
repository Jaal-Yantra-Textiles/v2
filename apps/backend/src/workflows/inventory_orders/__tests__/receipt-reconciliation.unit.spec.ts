import {
  aggregateHistory,
  aggregateRecords,
  reconcileOrderReceipts,
} from "../lib/receipt-reconciliation"

/**
 * Built on the real numbers from `inv_order_01K36TE2WB5BQR1MS6KESXP7Q3`
 * (hrhandloom, Partial, 244.5 units, ₹88,885 ordered), as recorded in #1613 —
 * a fixture tidier than that reality would certify the wrong arithmetic.
 *
 * | line          | ordered | typed      | blob      | rate |
 * |---------------|---------|------------|-----------|------|
 * | 01K36TE3TR…   | 16      | 16 (10+6)  | only the 6| 400  |
 * | 01K36TE425…   | 31      | 10         | 10        | 430  |
 * | 01K36TE4GX…   | 22      | 10.5       | 10.5      | 380  |
 * | 01K36TE4RB…   | 21      | 21         | 21        | 380  |
 * | 01K36TE56Y…   | 50      | 12         | 11.8      | 250  |
 *
 * Typed 69.5 units / ₹25,670 · blob 59.3 units / ₹21,620 → ₹4,050 understated.
 */
const realOrder = {
  orderlines: [
    {
      id: "01K36TE3TR",
      quantity: 16,
      price: 400,
      material_name: null,
      // Two receipts. The blob kept only the second.
      line_fulfillments: [{ quantity_delta: 10 }, { quantity_delta: 6 }],
    },
    {
      id: "01K36TE425",
      quantity: 31,
      price: 430,
      line_fulfillments: [{ quantity_delta: 10 }],
    },
    {
      id: "01K36TE4GX",
      quantity: 22,
      price: 380,
      line_fulfillments: [{ quantity_delta: 10.5 }],
    },
    {
      id: "01K36TE4RB",
      quantity: 21,
      price: 380,
      line_fulfillments: [{ quantity_delta: 21 }],
    },
    {
      id: "01K36TE56Y",
      quantity: 50,
      price: 250,
      line_fulfillments: [{ quantity_delta: 12 }],
    },
  ],
  metadata: {
    partner_delivered_lines: [
      { order_line_id: "01K36TE3TR", quantity: 6 },
      { order_line_id: "01K36TE425", quantity: 10 },
      { order_line_id: "01K36TE4GX", quantity: 10.5 },
      { order_line_id: "01K36TE4RB", quantity: 21 },
      { order_line_id: "01K36TE56Y", quantity: 11.8 },
    ],
  },
}

describe("reconcileOrderReceipts", () => {
  it("reproduces the ₹4,050 understatement on the real order", () => {
    const result = reconcileOrderReceipts(realOrder)

    expect(result.typed_total_units).toBeCloseTo(69.5, 5)
    expect(result.blob_total_units).toBeCloseTo(59.3, 5)
    expect(result.disagrees).toBe(true)
    // 10 units × ₹400 = 4,000, plus 0.2 × ₹250 = 50.
    expect(result.drift_value).toBeCloseTo(4050, 5)
  })

  it("names the receipt the blob never recorded", () => {
    const result = reconcileOrderReceipts(realOrder)
    const line = result.lines.find((l) => l.line_id === "01K36TE3TR")!

    expect(line.typed).toBe(16)
    expect(line.blob).toBe(6)
    expect(line.drift).toBe(10)
    expect(line.drift_value).toBe(4000)
  })

  /**
   * 🔴 The load-bearing case, and the reason this is not merely a reporting
   * problem. `computeAdminDeliveryPosting` posts `ordered − already` with
   * `already` read from the blob. On this line that is 16 − 6 = 10 units of
   * stock posted for goods already received, against a correct 16 − 16 = 0.
   */
  it("measures the stock an admin Deliver would post that was already received", () => {
    const result = reconcileOrderReceipts(realOrder)
    const line = result.lines.find((l) => l.line_id === "01K36TE3TR")!

    expect(line.admin_would_overpost).toBe(10)
    // 0.2 on the last line as well: 50−11.8 = 38.2 posted against 50−12 = 38.
    expect(result.admin_would_overpost).toBeCloseTo(10.2, 5)
  })

  /**
   * ⚠️ `quantity_delta` is a DELTA, and `adjust`/`correction` events can be
   * negative. Reading the latest row, or counting rows, gets this wrong.
   */
  it("sums deltas rather than taking the last one, and honours negatives", () => {
    const result = reconcileOrderReceipts({
      orderlines: [
        {
          id: "line_1",
          quantity: 10,
          price: 100,
          line_fulfillments: [
            { quantity_delta: 8 },
            { quantity_delta: -3 },
            { quantity_delta: 1 },
          ],
        },
      ],
      metadata: { partner_delivered_lines: [{ order_line_id: "line_1", quantity: 6 }] },
    })

    expect(result.lines[0].typed).toBe(6)
    expect(result.disagrees).toBe(false)
  })

  /**
   * The two sources disagree in BOTH directions, which is exactly why no
   * reader can simply be switched to the typed rows: where the typed side is
   * the one missing an entry, `already` gets SMALLER and the over-posting gets
   * worse. Measured, never corrected.
   */
  it("reports a blob that OVERstates as drift, with no over-posting exposure", () => {
    const result = reconcileOrderReceipts({
      orderlines: [
        {
          id: "line_1",
          quantity: 10,
          price: 100,
          line_fulfillments: [{ quantity_delta: 4 }],
        },
      ],
      metadata: { partner_delivered_lines: [{ order_line_id: "line_1", quantity: 9 }] },
    })

    expect(result.lines[0].drift).toBe(-5)
    expect(result.lines[0].drift_value).toBe(-500)
    // The admin path would post LESS than it should here, not more.
    expect(result.admin_would_overpost).toBe(0)
  })

  it("flags an order carrying a reversal note as undecidable", () => {
    const result = reconcileOrderReceipts({
      ...realOrder,
      metadata: {
        ...realOrder.metadata,
        reversal_note:
          "Reversed 9 incorrect fulfillments on 2026-02-28 — lines were auto-filled by UI bug",
      },
    })

    expect(result.undecidable).toBe(true)
    expect(result.reversal_note).toContain("Reversed 9 incorrect fulfillments")
  })

  it("reports agreeing lines too, so 'agrees at zero' is distinguishable from unexamined", () => {
    const result = reconcileOrderReceipts({
      orderlines: [{ id: "line_1", quantity: 10, price: 100, line_fulfillments: [] }],
      metadata: {},
    })

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].typed).toBe(0)
    expect(result.disagrees).toBe(false)
  })
})

describe("aggregateRecords / aggregateHistory", () => {
  it("sums repeated records for one line rather than keeping the last", () => {
    expect(
      aggregateRecords([
        { order_line_id: "line_1", quantity: 4 },
        { order_line_id: "line_1", quantity: 6 },
      ])
    ).toEqual({ line_1: 10 })
  })

  it("flattens every submission in the appended history", () => {
    expect(
      aggregateHistory([
        { lines: [{ order_line_id: "line_1", quantity: 10 }] },
        { lines: [{ order_line_id: "line_1", quantity: 6 }] },
      ])
    ).toEqual({ line_1: 16 })
  })

  it("ignores records with no line id rather than bucketing them together", () => {
    expect(aggregateRecords([{ quantity: 5 }, { order_line_id: null, quantity: 3 }])).toEqual({})
  })
})
