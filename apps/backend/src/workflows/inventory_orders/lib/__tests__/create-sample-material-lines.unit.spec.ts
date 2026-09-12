import {
  materialItemTitle,
  planNewMaterialLines,
} from "../create-sample-material-lines"

/**
 * Samples/swatch orders: a line may name cloth we have never stocked, and the
 * item is created as the line is written. The guards here all prevent the same
 * failure — silently minting a duplicate catalogue entry.
 */
describe("planNewMaterialLines", () => {
  it("plans a new line that names a material and points at nothing", () => {
    const plan = planNewMaterialLines([
      { new_material: { name: "Tangaliya Weave", color: "Indigo" } },
    ])
    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({ index: 0, material: { name: "Tangaliya Weave" } })
  })

  it("skips a line that already points at an inventory item", () => {
    // Creating an item beside the one the operator picked would duplicate it.
    expect(
      planNewMaterialLines([
        { inventory_item_id: "iitem_1", new_material: { name: "Tangaliya" } },
      ])
    ).toEqual([])
  })

  it("skips a line that names a variant", () => {
    expect(
      planNewMaterialLines([
        { variant_id: "variant_1", new_material: { name: "Tangaliya" } },
      ])
    ).toEqual([])
  })

  it("skips an EXISTING line", () => {
    // An `id` means the line is already written; it has an item behind it.
    expect(
      planNewMaterialLines([{ id: "line_1", new_material: { name: "Tangaliya" } }])
    ).toEqual([])
  })

  it("skips a removal", () => {
    expect(
      planNewMaterialLines([
        { remove: true, id: "line_1", new_material: { name: "Tangaliya" } },
      ])
    ).toEqual([])
  })

  it("ignores a blank or whitespace-only name", () => {
    expect(planNewMaterialLines([{ new_material: { name: "   " } }])).toEqual([])
    expect(planNewMaterialLines([{ new_material: { name: "" } }])).toEqual([])
    expect(planNewMaterialLines([{}])).toEqual([])
  })

  it("trims the name it plans to create", () => {
    expect(planNewMaterialLines([{ new_material: { name: "  Khadi  " } }])[0].material.name).toBe(
      "Khadi"
    )
  })

  it("reports POSITIONAL indexes so ids land on the right lines", () => {
    // The caller writes the created item id back by index; an off-by-one here
    // would attach a material to somebody else's line.
    const plan = planNewMaterialLines([
      { inventory_item_id: "iitem_1" },
      { new_material: { name: "Khadi" } },
      { id: "line_9" },
      { new_material: { name: "Ahimsa Silk" } },
    ])
    expect(plan.map((p) => p.index)).toEqual([1, 3])
  })
})

describe("materialItemTitle", () => {
  it("folds the colour into the title", () => {
    // Six items all called "Tangaliya Weave" cannot be told apart in a picker.
    expect(materialItemTitle({ name: "Tangaliya Weave", color: "Indigo" })).toBe(
      "Tangaliya Weave — Indigo"
    )
  })

  it("uses the bare name when no colour is given", () => {
    expect(materialItemTitle({ name: "Tangaliya Weave" })).toBe("Tangaliya Weave")
  })

  it("ignores a blank colour rather than trailing a dash", () => {
    expect(materialItemTitle({ name: "Khadi", color: "  " })).toBe("Khadi")
  })
})
