import {
  buildItemIdByRawMaterialId,
  splitResolvedAndMissing,
  buildResolvedOrderLines,
  sumGroupOrderTotal,
  sumGroupOrderQuantity,
  buildGroupColorTitle,
} from "../lib/group-order-helpers"

describe("buildGroupColorTitle (#846)", () => {
  it("appends the color to the provided name", () => {
    expect(buildGroupColorTitle("Tangaliya Suit", "Tangaliya Suit", "Pink")).toBe(
      "Tangaliya Suit — Pink"
    )
  })

  it("falls back to the group name when no explicit name is given", () => {
    expect(buildGroupColorTitle("Tangaliya Suit", "", "Blue")).toBe(
      "Tangaliya Suit — Blue"
    )
    expect(buildGroupColorTitle("Tangaliya Suit", null, "Blue")).toBe(
      "Tangaliya Suit — Blue"
    )
  })

  it("does not double-append a color the name already carries", () => {
    expect(
      buildGroupColorTitle("Poplin", "Verify Poplin — Teal", "Teal")
    ).toBe("Verify Poplin — Teal")
    expect(buildGroupColorTitle("Poplin", "Red Poplin", "red")).toBe("Red Poplin")
  })

  it("returns just the base when there is no color", () => {
    expect(buildGroupColorTitle("Group", "My Material", "")).toBe("My Material")
    expect(buildGroupColorTitle("Group", "My Material", null)).toBe("My Material")
  })

  it("returns just the color when there is no name or group", () => {
    expect(buildGroupColorTitle("", "", "Green")).toBe("Green")
  })

  it("trims surrounding whitespace", () => {
    expect(buildGroupColorTitle("  Group  ", "  ", "  Amber  ")).toBe(
      "Group — Amber"
    )
  })
})

describe("buildItemIdByRawMaterialId (#817 S3)", () => {
  it("maps raw_material_id -> inventory_item_id from link rows", () => {
    const map = buildItemIdByRawMaterialId([
      { raw_materials: { id: "rm_blue" }, inventory_item: { id: "iitem_blue" } },
      { raw_materials: { id: "rm_red" }, inventory_item: { id: "iitem_red" } },
    ])
    expect(map).toEqual({ rm_blue: "iitem_blue", rm_red: "iitem_red" })
  })

  it("skips rows missing either id and keeps the first item per raw material", () => {
    const map = buildItemIdByRawMaterialId([
      { raw_materials: { id: "rm_1" }, inventory_item: null },
      { raw_materials: null, inventory_item: { id: "iitem_x" } },
      { raw_materials: { id: "rm_2" }, inventory_item: { id: "iitem_2a" } },
      { raw_materials: { id: "rm_2" }, inventory_item: { id: "iitem_2b" } },
    ])
    expect(map).toEqual({ rm_2: "iitem_2a" })
  })

  it("tolerates a nullish input", () => {
    expect(buildItemIdByRawMaterialId(null as any)).toEqual({})
  })
})

describe("splitResolvedAndMissing (#817 S3)", () => {
  it("returns the deduped colors that have no inventory_item yet, in order", () => {
    const lines = [
      { raw_material_id: "rm_blue", quantity: 1, price: 1 },
      { raw_material_id: "rm_red", quantity: 2, price: 2 },
      { raw_material_id: "rm_red", quantity: 3, price: 3 },
      { raw_material_id: "rm_green", quantity: 4, price: 4 },
    ]
    const { missingRawMaterialIds } = splitResolvedAndMissing(lines, {
      rm_blue: "iitem_blue",
    })
    expect(missingRawMaterialIds).toEqual(["rm_red", "rm_green"])
  })

  it("returns nothing missing when every color is already resolved", () => {
    const { missingRawMaterialIds } = splitResolvedAndMissing(
      [{ raw_material_id: "rm_blue", quantity: 1, price: 1 }],
      { rm_blue: "iitem_blue" }
    )
    expect(missingRawMaterialIds).toEqual([])
  })
})

describe("buildResolvedOrderLines (#817 S3)", () => {
  it("fans out each color line to its resolved inventory_item", () => {
    const lines = [
      { raw_material_id: "rm_blue", quantity: 10, price: 5 },
      { raw_material_id: "rm_red", quantity: 4, price: 8 },
    ]
    expect(
      buildResolvedOrderLines(lines, {
        rm_blue: "iitem_blue",
        rm_red: "iitem_red",
      })
    ).toEqual([
      { inventory_item_id: "iitem_blue", quantity: 10, price: 5 },
      { inventory_item_id: "iitem_red", quantity: 4, price: 8 },
    ])
  })

  it("throws if a color could not be resolved to an item", () => {
    expect(() =>
      buildResolvedOrderLines(
        [{ raw_material_id: "rm_ghost", quantity: 1, price: 1 }],
        {}
      )
    ).toThrow(/No inventory item resolved/i)
  })
})

describe("group order totals (#817 S3 — price is per-unit)", () => {
  const lines = [
    { raw_material_id: "rm_blue", quantity: 10, price: 5 },
    { raw_material_id: "rm_red", quantity: 4, price: 8 },
  ]
  it("sums price × quantity per line", () => {
    expect(sumGroupOrderTotal(lines)).toBeCloseTo(82)
  })
  it("sums total quantity", () => {
    expect(sumGroupOrderQuantity(lines)).toBe(14)
  })
  it("treats missing/NaN as 0 and empty as 0", () => {
    expect(sumGroupOrderTotal([{ price: NaN as any, quantity: 3 }])).toBe(0)
    expect(sumGroupOrderQuantity([])).toBe(0)
  })
})
