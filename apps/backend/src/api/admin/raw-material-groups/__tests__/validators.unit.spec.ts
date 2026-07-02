import {
  createRawMaterialGroupSchema,
  updateRawMaterialGroupSchema,
  addGroupColorSchema,
} from "../validators"

describe("raw-material-group validators — dimensions/attributes (additive flexibility)", () => {
  it("accepts operator-defined dimensions on create", () => {
    const parsed = createRawMaterialGroupSchema.parse({
      name: "Cotton Poplin",
      dimensions: [
        { key: "color", label: "Color" },
        { key: "finish", label: "Finish", values: ["Matte", "Gloss"] },
      ],
    })
    expect(parsed.dimensions).toHaveLength(2)
    expect(parsed.dimensions?.[1]).toEqual({
      key: "finish",
      label: "Finish",
      values: ["Matte", "Gloss"],
    })
  })

  it("omits dimensions entirely when not provided (color-only default)", () => {
    const parsed = createRawMaterialGroupSchema.parse({ name: "Linen" })
    expect("dimensions" in parsed).toBe(false)
  })

  it("rejects a dimension missing its key/label", () => {
    expect(() =>
      updateRawMaterialGroupSchema.parse({ dimensions: [{ label: "Finish" }] })
    ).toThrow()
  })

  it("accepts per-member attributes on a color add", () => {
    const parsed = addGroupColorSchema.parse({
      name: "Blue Matte",
      color: "Blue",
      attributes: { color: "Blue", finish: "Matte" },
    })
    expect(parsed.attributes).toEqual({ color: "Blue", finish: "Matte" })
  })
})
