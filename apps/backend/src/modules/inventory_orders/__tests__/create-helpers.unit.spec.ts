import {
  buildOrderLinePayloads,
  buildInventoryLineLinkPairs,
  sumLineTotals,
  buildMaterialLookupByInventoryId,
  enrichOrderLinesWithMaterial,
  planMaterialBackfill,
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
      { quantity: 10, price: 50, metadata: { sku: "A" }, inventory_orders: "invord_1", batch_number: null, color: null, material_name: null, raw_material_id: null },
      { quantity: 4, price: 100, metadata: null, inventory_orders: "invord_1", batch_number: null, color: null, material_name: null, raw_material_id: null },
    ])
  })

  it("does NOT carry inventory_id onto the payload (no such column on the line)", () => {
    const [payload] = buildOrderLinePayloads(
      [{ inventory_id: "iitem_1", quantity: 1, price: 1 }],
      "invord_1"
    )
    expect(payload).not.toHaveProperty("inventory_id")
  })

  it("passes through denormalized color identity when present (#817 S2)", () => {
    const [payload] = buildOrderLinePayloads(
      [{
        inventory_id: "iitem_1", quantity: 1, price: 1,
        color: "Blue", material_name: "Cotton Poplin", raw_material_id: "rm_1",
      }],
      "invord_1"
    )
    expect(payload).toMatchObject({ color: "Blue", material_name: "Cotton Poplin", raw_material_id: "rm_1" })
  })
})

describe("buildMaterialLookupByInventoryId (#817 S2)", () => {
  it("maps inventory_item id -> color identity from an object relation", () => {
    const lookup = buildMaterialLookupByInventoryId([
      { id: "iitem_1", raw_materials: { id: "rm_1", color: "Blue", name: "Cotton Poplin" } },
    ])
    expect(lookup["iitem_1"]).toEqual({ color: "Blue", material_name: "Cotton Poplin", raw_material_id: "rm_1" })
  })

  it("handles the relation coming back as a single-element array", () => {
    const lookup = buildMaterialLookupByInventoryId([
      { id: "iitem_2", raw_materials: [{ id: "rm_2", color: "Red", name: "Linen" }] },
    ])
    expect(lookup["iitem_2"]).toEqual({ color: "Red", material_name: "Linen", raw_material_id: "rm_2" })
  })

  it("maps items with no linked raw_material to all-null", () => {
    const lookup = buildMaterialLookupByInventoryId([
      { id: "iitem_3", raw_materials: null },
      { id: "iitem_4" },
    ])
    expect(lookup["iitem_3"]).toEqual({ color: null, material_name: null, raw_material_id: null })
    expect(lookup["iitem_4"]).toEqual({ color: null, material_name: null, raw_material_id: null })
  })

  it("skips entries without an id and tolerates an empty/nullish input", () => {
    expect(buildMaterialLookupByInventoryId([{ id: "" } as any])).toEqual({})
    expect(buildMaterialLookupByInventoryId(null as any)).toEqual({})
  })
})

describe("enrichOrderLinesWithMaterial (#817 S2)", () => {
  it("merges color identity onto lines by inventory_id, leaving unknown lines untouched", () => {
    const lines = [
      { inventory_id: "iitem_1", quantity: 2, price: 5 },
      { inventory_id: "iitem_x", quantity: 1, price: 3 },
    ]
    const lookup = {
      iitem_1: { color: "Blue", material_name: "Cotton", raw_material_id: "rm_1" },
    }
    expect(enrichOrderLinesWithMaterial(lines, lookup)).toEqual([
      { inventory_id: "iitem_1", quantity: 2, price: 5, color: "Blue", material_name: "Cotton", raw_material_id: "rm_1" },
      { inventory_id: "iitem_x", quantity: 1, price: 3 },
    ])
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

/**
 * #1613 scope item 4 — the historical population of the #817 S2 columns.
 *
 * All ten lines on `inv_order_01K36TE2WB5BQR1MS6KESXP7Q3` are NULL on colour,
 * material name and raw material id, so that order cannot say what material any
 * of its lines is for. The values were always recoverable through the module
 * link; the lines predate the code that copies them.
 */
describe("planMaterialBackfill (#1613 scope item 4)", () => {
  const info = {
    color: "Dusty Rose",
    material_name: "Organic Kala Cotton",
    raw_material_id: "rm_1",
  }
  const lookup = { iitem_1: info }

  const line = (over: Record<string, any> = {}) => ({
    id: "ol_1",
    color: null,
    material_name: null,
    raw_material_id: null,
    inventory_items: [{ id: "iitem_1" }],
    ...over,
  })

  it("fills all three fields from the link when the line has none", () => {
    expect(planMaterialBackfill([line()], lookup)).toEqual([
      { line_id: "ol_1", inventory_item_id: "iitem_1", field: "color", after: "Dusty Rose" },
      { line_id: "ol_1", inventory_item_id: "iitem_1", field: "material_name", after: "Organic Kala Cotton" },
      { line_id: "ol_1", inventory_item_id: "iitem_1", field: "raw_material_id", after: "rm_1" },
    ])
  })

  it("never overwrites a value that is already there — per FIELD, not per line", () => {
    // 🔴 A populated column is somebody's answer. The link is the source for a
    // line that never got one, not a licence to correct one that did. A line
    // with a colour and no name must still get the name.
    const planned = planMaterialBackfill(
      [line({ color: "Indigo" })],
      lookup
    )
    expect(planned.map((c) => c.field)).toEqual(["material_name", "raw_material_id"])
  })

  it("treats an EMPTY STRING as missing, not as an answer", () => {
    // `'' ` passes `is not null`. A line holding "" is exactly as unable to say
    // what it is for as one holding null, and `!= null` would skip it forever.
    expect(
      planMaterialBackfill([line({ material_name: "   " })], lookup).map((c) => c.field)
    ).toEqual(["color", "material_name", "raw_material_id"])
  })

  it("writes nothing when the item has no linked raw material", () => {
    // Writing null over null reports work and does none; absence here is not
    // repairable.
    expect(
      planMaterialBackfill([line()], {
        iitem_1: { color: null, material_name: null, raw_material_id: null },
      })
    ).toEqual([])
  })

  it("fills only the fields the link can actually supply", () => {
    expect(
      planMaterialBackfill([line()], {
        iitem_1: { color: null, material_name: "Kala Cotton", raw_material_id: "rm_2" },
      }).map((c) => c.field)
    ).toEqual(["material_name", "raw_material_id"])
  })

  it("skips a line whose inventory link is the all-null placeholder row", () => {
    // ⚠️ `query.graph` returns ONE row of nulls for an empty relation, so
    // `inventory_items.length === 1` for a line with no link at all. Reading
    // `[0].id` here would carry `undefined` into the lookup.
    expect(
      planMaterialBackfill([line({ inventory_items: [{ id: null }] })], lookup)
    ).toEqual([])
    expect(planMaterialBackfill([line({ inventory_items: [] })], lookup)).toEqual([])
    expect(planMaterialBackfill([line({ inventory_items: null })], lookup)).toEqual([])
  })

  it("skips a line whose item is absent from the lookup entirely", () => {
    expect(planMaterialBackfill([line()], {})).toEqual([])
  })

  it("agrees with what the CREATE path would have written", () => {
    // 🔑 The point of the backfill: a repaired line must hold exactly what a
    // line created today holds, not a second opinion. Both sides derive from
    // `buildMaterialLookupByInventoryId`, so this pins them together.
    const items = [
      { id: "iitem_1", raw_materials: [{ id: "rm_1", color: "Dusty Rose", name: "Organic Kala Cotton" }] },
    ]
    const fromCreate = buildMaterialLookupByInventoryId(items as any)
    const enriched = enrichOrderLinesWithMaterial(
      [{ inventory_id: "iitem_1", quantity: 1, price: 300 } as any],
      fromCreate
    )[0] as any

    const planned = planMaterialBackfill([line()], fromCreate)
    for (const change of planned) {
      expect(change.after).toBe(String(enriched[change.field]))
    }
    expect(planned).toHaveLength(3)
  })

  it("handles several lines, reporting each against its own item", () => {
    const planned = planMaterialBackfill(
      [
        line(),
        line({ id: "ol_2", inventory_items: [{ id: "iitem_2" }] }),
      ],
      {
        ...lookup,
        iitem_2: { color: null, material_name: "Muga Silk", raw_material_id: "rm_2" },
      }
    )
    expect(planned.filter((c) => c.line_id === "ol_1")).toHaveLength(3)
    expect(planned.filter((c) => c.line_id === "ol_2")).toEqual([
      { line_id: "ol_2", inventory_item_id: "iitem_2", field: "material_name", after: "Muga Silk" },
      { line_id: "ol_2", inventory_item_id: "iitem_2", field: "raw_material_id", after: "rm_2" },
    ])
  })
})
