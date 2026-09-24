import { materialFromText } from "../material-from-text"
import { MATERIALS } from "../classify-evidence"

describe("materialFromText", () => {
  // Every string below was copied into `material` by a prod records scan on
  // 2026-09-24 (#2249). None of them names a fibre.
  it.each([
    "White Stripes Fabric",
    "Red Jaamdani with white prints",
    "Black Jaamdaani with print",
    "Pant Material Handloom (Split)",
    "Tangaliya Weave Fabric — Black",
  ])("names no material for the free-text line %p", (text) => {
    expect(materialFromText(text)).toBeNull()
  })

  it.each([
    ["Patterned Block Cotton Animal", "cotton"],
    ["100% cotton dary", "cotton"],
    ["Matka (H.S+H.W)", "matka silk"],
    ["Muslin 150s hh", "muslin"],
    ["Kala Cotton", "kala cotton"],
    ["Handloom Denim Cotton", "denim"],
    ["White Terry Towel", "terry"],
    ["Tassar Desi Silk Fabric", "tussar silk"],
    ["Hand-Woven Wool Tweed", "wool"],
    ["Solid Pashmina", "pashmina"],
    ["Vilot Silk Raw", "mulberry silk"],
    ["60lea Linen (H.W)", "linen"],
  ])("reads %p as %p", (text, label) => {
    expect(materialFromText(text)).toBe(label)
  })

  it("calls two fibre families a blend", () => {
    expect(materialFromText("Cotton and Wool Handloom")).toBe("blend")
    expect(materialFromText("Ahimsa Silk and Cotton Robe")).toBe("blend")
    expect(materialFromText("Poly viscose suiting")).toBe("blend")
  })

  it("is empty for nothing", () => {
    expect(materialFromText(null)).toBeNull()
    expect(materialFromText("   ")).toBeNull()
  })

  it("only ever answers with a label the classifier also uses", () => {
    const labels = new Set(Object.values(MATERIALS).map((m) => m.label).filter(Boolean))
    for (const text of ["kala cotton", "organic cotton", "khadi", "mulmul", "denim", "terry", "cotton", "linen", "hemp", "nettle", "jute", "cashmere", "merino", "peace silk", "tasar", "matka", "eri silk", "silk", "blend"]) {
      expect(labels).toContain(materialFromText(text))
    }
  })
})
