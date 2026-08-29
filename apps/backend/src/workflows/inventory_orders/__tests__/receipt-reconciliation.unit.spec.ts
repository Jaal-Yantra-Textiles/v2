import {
  aggregateHistory,
  aggregateRecords,
  detectRoundedReceipts,
  reconcileOrderReceipts,
} from "../lib/receipt-reconciliation"

/**
 * Built on `inv_order_01K36TE2WB5BQR1MS6KESXP7Q3` as it actually stands in
 * PRODUCTION, read back from the admin API — not from the table in #1613, which
 * compared the typed rows against the *history* aggregate rather than against
 * the key the live readers actually read.
 *
 * hrhandloom · Partial · 244.5 units ordered · ₹88,885 · ordered 2025-08-20.
 *
 * Typed receipts, five lines of ten carry any (the rest were never delivered):
 *
 * | line          | ordered | typed      | rate | value  |
 * |---------------|---------|------------|------|--------|
 * | 01K36TE3TR…   | 16      | 16 (10+6)  | 400  | 6,400  |
 * | 01K36TE425…   | 31      | 10         | 430  | 4,300  |
 * | 01K36TE4GX…   | 22      | 10.5       | 380  | 3,990  |
 * | 01K36TE4RB…   | 21      | 21         | 380  | 7,980  |
 * | 01K36TE56Y…   | 50      | 12         | 250  | 3,000  |
 *                                   69.5 units · ₹25,670
 *
 * 🔴 And `metadata.partner_delivered_lines` — what `computeAdminDeliveryPosting`
 * and `cancel-inventory-order` read — holds **one record**: 10.5 units on
 * `01K36TE4GX…`, the most recent of FIVE submissions. The partner path
 * overwrites that key, so the other four deliveries are simply not in it.
 * `partner_delivery_history` has all five.
 *
 * So the gap against the operative key is 59 units / ₹21,680, not the ₹4,050 the
 * issue records against the history.
 */
const realOrder = {
  orderlines: [
    {
      id: "01K36TE3TR",
      quantity: 16,
      price: 400,
      material_name: null,
      // Two receipts, 2026-07-22 and earlier.
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
    // 🔴 ONE record — the most recent submission. This is production, verbatim.
    partner_delivered_lines: [
      { order_line_id: "01K36TE4GX", quantity: 10.5 },
    ],
    // All five submissions survive here, because this key is appended to.
    partner_delivery_history: [
      { lines: [{ order_line_id: "01K36TE425", quantity: 10 }] },
      { lines: [{ order_line_id: "01K36TE56Y", quantity: 11.8 }] },
      { lines: [{ order_line_id: "01K36TE4RB", quantity: 21 }] },
      { lines: [{ order_line_id: "01K36TE3TR", quantity: 6 }] },
      { lines: [{ order_line_id: "01K36TE4GX", quantity: 10.5 }] },
    ],
  },
}

describe("reconcileOrderReceipts", () => {
  /**
   * 🔴 Measured against `partner_delivered_lines`, which is what the live
   * readers read — 59 units and ₹21,680, not the ₹4,050 #1613 records against
   * the history. Four of five deliveries are missing from the operative key.
   */
  it("measures the gap against the key the readers actually read", () => {
    const result = reconcileOrderReceipts(realOrder)

    expect(result.typed_total_units).toBeCloseTo(69.5, 5)
    expect(result.blob_total_units).toBeCloseTo(10.5, 5)
    expect(result.disagrees).toBe(true)
    expect(result.drift_value).toBeCloseTo(21680, 5)
  })

  /**
   * The history is nearly complete, which is exactly what makes the overwrite
   * easy to miss: reconcile against IT and the order looks 0.2 units out.
   */
  it("shows the history holding what the overwritten key lost", () => {
    const result = reconcileOrderReceipts(realOrder)
    const byId = Object.fromEntries(result.lines.map((l) => [l.line_id, l]))

    expect(byId["01K36TE3TR"].blob).toBe(0)
    expect(byId["01K36TE3TR"].history).toBe(6)
    expect(byId["01K36TE4RB"].blob).toBe(0)
    expect(byId["01K36TE4RB"].history).toBe(21)
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

    // 16 received, 0 in the blob → the whole 16 would be posted a second time.
    expect(line.admin_would_overpost).toBe(16)
    // Across the order: 16 + 10 + 0 + 21 + 12.
    expect(result.admin_would_overpost).toBeCloseTo(59, 5)
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

/**
 * #342 — `line_fulfillment.quantity_delta` was an INTEGER column until
 * Migration20260612202252, so Postgres rounded every fractional receipt on the
 * way in. On `inv_order_01K36TE2WB5BQR1MS6KESXP7Q3` the partner submitted 11.8
 * of Kala cotton white on 2026-02-28; the typed row stored **12** while
 * `partner_delivery_history` — a jsonb blob, and so unrounded — kept **11.8**.
 * Physical stock holds 11.8, so the receipt row is the only thing that is wrong.
 *
 * The forward fix shipped in #342. These rows were never corrected, and the
 * payout path reads the receipts, so the partner is credited 12 for 11.8.
 */
describe("detectRoundedReceipts", () => {
  const kalaCotton = {
    orderlines: [
      {
        id: "01K36TE56Y",
        quantity: 50,
        price: 250,
        line_fulfillments: [
          {
            id: "lf_kala",
            quantity_delta: 12,
            created_at: "2026-02-28T08:52:56.245Z",
          },
        ],
      },
    ],
    metadata: {
      partner_delivery_history: [
        { lines: [{ order_line_id: "01K36TE56Y", quantity: 11.8 }] },
      ],
    },
  }

  it("finds the 11.8 that was stored as 12", () => {
    expect(detectRoundedReceipts(kalaCotton)).toEqual([
      {
        fulfillment_id: "lf_kala",
        line_id: "01K36TE56Y",
        stored: 12,
        actual: 11.8,
        created_at: "2026-02-28T08:52:56.245Z",
      },
    ])
  })

  /**
   * 🔴 The guard that keeps this from inventing deliveries. The same order has
   * a line where the typed rows hold 16 and the blob holds nothing — a gap of
   * 10 units, which is a MISSING RECEIPT, not a rounding error. Repairing that
   * as rounding would rewrite a real delivery.
   */
  it("ignores a whole-unit gap, which is a missing receipt not a rounding", () => {
    expect(
      detectRoundedReceipts({
        orderlines: [
          {
            id: "line_1",
            quantity: 16,
            price: 400,
            line_fulfillments: [
              { id: "lf_1", quantity_delta: 16, created_at: "2026-02-28T00:00:00Z" },
            ],
          },
        ],
        metadata: {
          partner_delivery_history: [
            { lines: [{ order_line_id: "line_1", quantity: 6 }] },
          ],
        },
      })
    ).toEqual([])
  })

  it("ignores receipts written after the column became real", () => {
    expect(
      detectRoundedReceipts({
        orderlines: [
          {
            id: "line_1",
            quantity: 22,
            price: 380,
            line_fulfillments: [
              // 2026-08-17, after the migration: 10.5 stored as 10.5, correctly.
              { id: "lf_1", quantity_delta: 11, created_at: "2026-08-17T09:41:17Z" },
            ],
          },
        ],
        metadata: {
          partner_delivery_history: [
            { lines: [{ order_line_id: "line_1", quantity: 10.5 }] },
          ],
        },
      })
    ).toEqual([])
  })

  /**
   * With two receipts on a line there is no way to say which history entry
   * belongs to which row, so pairing them would be a guess.
   */
  it("refuses a line with more than one receipt", () => {
    expect(
      detectRoundedReceipts({
        orderlines: [
          {
            id: "line_1",
            quantity: 16,
            price: 400,
            line_fulfillments: [
              { id: "lf_1", quantity_delta: 10, created_at: "2026-02-28T00:00:00Z" },
              { id: "lf_2", quantity_delta: 6, created_at: "2026-02-28T00:00:00Z" },
            ],
          },
        ],
        metadata: {
          partner_delivery_history: [
            { lines: [{ order_line_id: "line_1", quantity: 9.6 }] },
          ],
        },
      })
    ).toEqual([])
  })

  it("ignores a history figure that is already whole", () => {
    expect(
      detectRoundedReceipts({
        orderlines: [
          {
            id: "line_1",
            quantity: 21,
            price: 380,
            line_fulfillments: [
              { id: "lf_1", quantity_delta: 21, created_at: "2026-02-28T00:00:00Z" },
            ],
          },
        ],
        metadata: {
          partner_delivery_history: [
            { lines: [{ order_line_id: "line_1", quantity: 21 }] },
          ],
        },
      })
    ).toEqual([])
  })
})
