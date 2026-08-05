import {
  nonEmptyCode,
  resolveVariantHsCode,
  suggestHsCodeTarget,
} from "../hs-code-resolution"

/**
 * The read side and the write side of HS codes must agree, or the tooling
 * cheerfully writes codes into a level the label never looks at. These tests
 * pin the precedence chain and the placement rule that pairs with it.
 */
describe("nonEmptyCode", () => {
  it("trims and returns real values", () => {
    expect(nonEmptyCode("6214")).toBe("6214")
    expect(nonEmptyCode("  6214  ")).toBe("6214")
    expect(nonEmptyCode(6214)).toBe("6214")
  })

  it("treats blank and nullish as absent", () => {
    // A blank must not win the chain — it would shadow a real code one level
    // down and produce a label the carrier rejects.
    expect(nonEmptyCode("")).toBeUndefined()
    expect(nonEmptyCode("   ")).toBeUndefined()
    expect(nonEmptyCode(null)).toBeUndefined()
    expect(nonEmptyCode(undefined)).toBeUndefined()
  })
})

describe("resolveVariantHsCode", () => {
  it("prefers the variant's own code", () => {
    expect(
      resolveVariantHsCode({
        hs_code: "1111",
        inventory_items: [{ inventory: { hs_code: "2222" } }],
        product: { hs_code: "3333" },
      })
    ).toEqual({ hs_code: "1111", level: "variant" })
  })

  it("falls through to the inventory item", () => {
    expect(
      resolveVariantHsCode({
        inventory_items: [{ inventory: { hs_code: "2222" } }],
        product: { hs_code: "3333" },
      })
    ).toEqual({ hs_code: "2222", level: "inventory_item" })
  })

  it("falls through to the product", () => {
    expect(
      resolveVariantHsCode({ product: { hs_code: "3333" } })
    ).toEqual({ hs_code: "3333", level: "product" })
  })

  it("skips blank inventory codes to reach a later one", () => {
    expect(
      resolveVariantHsCode({
        inventory_items: [
          { inventory: { hs_code: null } },
          { inventory: { hs_code: "  " } },
          { inventory: { hs_code: "5007" } },
        ],
      }).hs_code
    ).toBe("5007")
  })

  it("returns an empty result for a variant with nothing, or no variant", () => {
    expect(resolveVariantHsCode({})).toEqual({})
    expect(resolveVariantHsCode(null)).toEqual({})
    expect(resolveVariantHsCode(undefined)).toEqual({})
  })
})

describe("suggestHsCodeTarget", () => {
  it("targets the inventory item when the variant manages inventory", () => {
    expect(
      suggestHsCodeTarget(
        {
          id: "var_1",
          manage_inventory: true,
          inventory_items: [{ inventory: { id: "iitem_1" } }],
        },
        "prod_1"
      )
    ).toEqual({ level: "inventory_item", id: "iitem_1" })
  })

  it("targets the product when variants exist but manage no inventory", () => {
    // The operator's rule: an unmanaged variant is really just an option of the
    // product, so one product-level code covers every sibling at once.
    expect(
      suggestHsCodeTarget({ id: "var_1", manage_inventory: false }, "prod_1")
    ).toEqual({ level: "product", id: "prod_1" })
  })

  it("targets the product when inventory is managed but no item is linked", () => {
    // manage_inventory with no resolvable inventory item would otherwise
    // produce a target id of undefined.
    expect(
      suggestHsCodeTarget(
        { id: "var_1", manage_inventory: true, inventory_items: [] },
        "prod_1"
      )
    ).toEqual({ level: "product", id: "prod_1" })
  })

  it("falls back to the variant when there is no product id", () => {
    expect(suggestHsCodeTarget({ id: "var_1" }, null)).toEqual({
      level: "variant",
      id: "var_1",
    })
  })

  it("returns null when there is nothing to target", () => {
    expect(suggestHsCodeTarget(null, "prod_1")).toBeNull()
    expect(suggestHsCodeTarget({}, null)).toBeNull()
  })

  it("uses the link's inventory_item_id when the nested inventory is absent", () => {
    expect(
      suggestHsCodeTarget(
        {
          id: "var_1",
          manage_inventory: true,
          inventory_items: [{ inventory_item_id: "iitem_9" }],
        },
        "prod_1"
      )
    ).toEqual({ level: "inventory_item", id: "iitem_9" })
  })
})
