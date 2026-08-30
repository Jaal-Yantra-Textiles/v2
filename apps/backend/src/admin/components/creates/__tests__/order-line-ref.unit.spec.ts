import { toOrderLineRef, variantIdFromRef } from "../order-line-ref"

/**
 * #1662. The picker holds one value per row for two kinds of row. This is the
 * only place that reads the synthetic id — the point of the test is that the
 * synthetic string never leaves the client as an `inventory_item_id`.
 */
describe("toOrderLineRef", () => {
  it("sends a real item id as inventory_item_id", () => {
    expect(toOrderLineRef("iitem_01ABC")).toEqual({
      inventory_item_id: "iitem_01ABC",
    })
  })

  it("sends an untracked pick as variant_id, never as an item id", () => {
    const ref = toOrderLineRef("untracked_variant:variant_01XYZ")
    expect(ref).toEqual({ variant_id: "variant_01XYZ" })
    expect(ref).not.toHaveProperty("inventory_item_id")
  })

  it("emits exactly one key, matching the validator's either/or rule", () => {
    expect(Object.keys(toOrderLineRef("iitem_1")!)).toEqual(["inventory_item_id"])
    expect(Object.keys(toOrderLineRef("untracked_variant:v_1")!)).toEqual([
      "variant_id",
    ])
  })

  it("returns null for an empty pick, so a blank row is dropped not sent", () => {
    expect(toOrderLineRef("")).toBeNull()
    expect(toOrderLineRef(undefined)).toBeNull()
  })

  it("treats a prefix with nothing after it as not a variant reference", () => {
    expect(variantIdFromRef("untracked_variant:")).toBeNull()
    expect(toOrderLineRef("untracked_variant:")).toEqual({
      inventory_item_id: "untracked_variant:",
    })
  })
})
