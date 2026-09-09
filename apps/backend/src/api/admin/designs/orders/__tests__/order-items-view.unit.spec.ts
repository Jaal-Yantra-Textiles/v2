import {
  buildOrderItemRow,
  fulfilmentStateOf,
  readQty,
  summariseOrderItems,
  type RawOrderItem,
} from "../order-items-view"

/**
 * #1918 — ordered vs delivered, on Aline's real order.
 *
 * order_01KNP520PT94BN8SC0JKZ6ZVJ9: 5 items, 1 delivered, 4 owed. Three of the
 * four owed have a null variant_id, which is what makes them uneditable.
 */

const item = (o: Partial<RawOrderItem>): RawOrderItem => ({
  id: "ordli_x",
  title: "Thing",
  quantity: 1,
  variant_id: "variant_x",
  detail: { fulfilled_quantity: 0, shipped_quantity: 0, delivered_quantity: 0 },
  ...o,
})

describe("readQty", () => {
  it("keeps a real 0 and reports absence as null", () => {
    expect(readQty(0)).toBe(0)
    expect(readQty(null)).toBeNull()
    expect(readQty(undefined)).toBeNull()
    expect(readQty("")).toBeNull()
    expect(readQty("2")).toBe(2)
  })
})

describe("fulfilmentStateOf", () => {
  it("🔴 delivered wins even when shipped is 0 — they are not a ladder", () => {
    // Aline's Flowy Skirt is exactly this: delivered 1, shipped 0. A rule
    // requiring shipped-before-delivered reports a garment she is holding as
    // still outstanding.
    expect(
      fulfilmentStateOf(
        item({ detail: { fulfilled_quantity: 1, shipped_quantity: 0, delivered_quantity: 1 } })
      )
    ).toBe("delivered")
  })

  it("reports shipped-but-not-delivered as shipped, not outstanding", () => {
    expect(
      fulfilmentStateOf(
        item({ detail: { fulfilled_quantity: 1, shipped_quantity: 1, delivered_quantity: 0 } })
      )
    ).toBe("shipped")
  })

  it("reports made-but-not-shipped as ready", () => {
    expect(
      fulfilmentStateOf(
        item({ detail: { fulfilled_quantity: 1, shipped_quantity: 0, delivered_quantity: 0 } })
      )
    ).toBe("made")
  })

  it("all zero, or no detail at all, is outstanding", () => {
    expect(fulfilmentStateOf(item({}))).toBe("outstanding")
    expect(fulfilmentStateOf(item({ detail: null }))).toBe("outstanding")
    expect(fulfilmentStateOf({ id: "x" })).toBe("outstanding")
  })
})

describe("buildOrderItemRow", () => {
  it("🔴 marks a null-variant line UNEDITABLE and says why", () => {
    // Three of Aline's four owed items are in this state. Offering an edit
    // button here would fail at the order-edit call.
    const row = buildOrderItemRow(item({ variant_id: null }), null)
    expect(row.editable).toBe(false)
    expect(row.uneditable_reason).toMatch(/no variant/i)
  })

  it("marks a line with a variant as editable", () => {
    expect(buildOrderItemRow(item({ variant_id: "variant_y" }), null).editable).toBe(true)
  })

  it("🔴 falls back to detail.quantity when item.quantity is null", () => {
    // `query.graph` on `order` returns a null `items.quantity` in the shape this
    // route uses. Reading only the top-level field rendered "Ordered 0" on every
    // line of a screen whose entire purpose is ordered vs delivered — caught by
    // rendering the page, not by any test, because fixtures set it directly.
    const row = buildOrderItemRow(
      item({ quantity: null, detail: { quantity: 2, delivered_quantity: 0 } }),
      null
    )
    expect(row.ordered).toBe(2)
  })

  it("prefers the top-level quantity when both are present", () => {
    const row = buildOrderItemRow(
      item({ quantity: 3, detail: { quantity: 99, delivered_quantity: 0 } }),
      null
    )
    expect(row.ordered).toBe(3)
  })

  it("distinguishes a never-tracked delivery from a known zero", () => {
    const untracked = buildOrderItemRow(item({ detail: {} }), null)
    const knownZero = buildOrderItemRow(
      item({ detail: { delivered_quantity: 0 } }),
      null
    )
    expect(untracked.delivered).toBeNull()
    expect(knownZero.delivered).toBe(0)
  })

  it("surfaces the design and what the line was ORIGINALLY ordered as", () => {
    const row = buildOrderItemRow(
      item({ metadata: { design_id: "d_new", original_design_id: "d_first" } }),
      { id: "d_new", name: "Successor", source: "link" }
    )
    expect(row.design?.id).toBe("d_new")
    expect(row.design?.source).toBe("link")
    expect(row.original_design_id).toBe("d_first")
  })

  it("carries no design without inventing one", () => {
    const row = buildOrderItemRow(item({}), null)
    expect(row.design).toBeNull()
    expect(row.original_design_id).toBeNull()
  })
})

describe("summariseOrderItems — Aline's order", () => {
  const alines = [
    // Flowy Skirt: delivered.
    buildOrderItemRow(
      item({ id: "ordli_skirt", title: "Flowy Skirt", variant_id: "variant_01KVCY5",
             detail: { fulfilled_quantity: 1, shipped_quantity: 0, delivered_quantity: 1 } }),
      null
    ),
    // The four owed. Three have no variant.
    buildOrderItemRow(item({ id: "ordli_jacket", title: "Floral Prints Open Jacket", variant_id: null }), null),
    buildOrderItemRow(item({ id: "ordli_dress", title: "Simple blue striped white dress", variant_id: null }), null),
    buildOrderItemRow(item({ id: "ordli_dark", title: "Dark Desires Dress", variant_id: null }), null),
    buildOrderItemRow(item({ id: "ordli_jungle", title: "Jolly jungle", variant_id: "variant_01M20AXJ" }), null),
  ]

  it("counts 5 ordered, 1 delivered, 4 outstanding", () => {
    const s = summariseOrderItems(alines)
    expect(s.ordered_total).toBe(5)
    expect(s.delivered_total).toBe(1)
    expect(s.outstanding_total).toBe(4)
    expect(s.has_outstanding).toBe(true)
  })

  it("🔴 outstanding comes from STATE, not ordered minus delivered", () => {
    // A shipped-not-delivered line is not outstanding work, even though the
    // subtraction says it is. Telling an admin it is owed sends them chasing a
    // garment already on a van.
    const shipped = buildOrderItemRow(
      item({ id: "ordli_ship", detail: { fulfilled_quantity: 1, shipped_quantity: 1, delivered_quantity: 0 } }),
      null
    )
    const s = summariseOrderItems([shipped])
    expect(s.ordered_total - s.delivered_total).toBe(1) // what subtraction says
    expect(s.outstanding_total).toBe(0)                 // what is actually true
    expect(s.has_outstanding).toBe(false)
  })

  it("reports 3 of the 4 owed lines as uneditable", () => {
    const owed = alines.filter((r) => r.state === "outstanding")
    expect(owed).toHaveLength(4)
    expect(owed.filter((r) => !r.editable)).toHaveLength(3)
  })

  it("🔴 does NOT say 'All delivered' for made-but-undelivered lines", () => {
    // The rendered bug: a green "All delivered" badge sat directly above
    // "3 ordered · 0 delivered", because nothing was OUTSTANDING. Made and
    // shipped are neither owed nor arrived.
    const made = [1, 2, 3].map((n) =>
      buildOrderItemRow(
        item({ id: `i${n}`, quantity: 1, detail: { fulfilled_quantity: 1, delivered_quantity: 0 } }),
        null
      )
    )
    const s = summariseOrderItems(made)
    expect(s.has_outstanding).toBe(false)
    expect(s.verdict).toBe("in_progress")
    expect(s.verdict_label).not.toMatch(/delivered/i)
  })

  it("says 'All delivered' only when every ordered unit arrived", () => {
    // NOTE: `quantity` must be set at the TOP level here — the helper defaults
    // it to 1 and the top-level value wins over detail.quantity, so setting
    // only detail.quantity would silently test a 1-unit line.
    const done = buildOrderItemRow(
      item({ quantity: 2, detail: { fulfilled_quantity: 2, delivered_quantity: 2 } }),
      null
    )
    expect(summariseOrderItems([done]).verdict).toBe("all_delivered")

    const partial = buildOrderItemRow(
      item({ quantity: 2, detail: { fulfilled_quantity: 2, delivered_quantity: 1 } }),
      null
    )
    expect(summariseOrderItems([partial]).verdict).toBe("in_progress")
  })

  it("an empty order is not 'all delivered'", () => {
    expect(summariseOrderItems([]).verdict).toBe("in_progress")
  })

  it("handles an empty order without inventing totals", () => {
    const s = summariseOrderItems([])
    expect(s.ordered_total).toBe(0)
    expect(s.has_outstanding).toBe(false)
  })
})
