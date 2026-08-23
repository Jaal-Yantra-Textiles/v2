import {
  MAX_PRODUCT_TYPE_LENGTH,
  mayInferOver,
  normalizeProductType,
} from "../lib/product-type"

describe("normalizeProductType", () => {
  it("lowercases and underscores so two spellings compare equal", () => {
    expect(normalizeProductType("Kurta")).toBe("kurta")
    expect(normalizeProductType("  kurta  ")).toBe("kurta")
    expect(normalizeProductType("Cushion Cover")).toBe("cushion_cover")
    expect(normalizeProductType("cushion-cover")).toBe("cushion_cover")
    // The whole point of normalising: these must not be three types.
    const spellings = ["Kurta", "kurta ", "KURTA"].map(normalizeProductType)
    expect(new Set(spellings).size).toBe(1)
  })

  it("strips punctuation a model's prose leaks in", () => {
    expect(normalizeProductType('"trousers"')).toBe("trousers")
    expect(normalizeProductType("saree.")).toBe("saree")
    expect(normalizeProductType("stole / scarf")).toBe("stole_scarf")
  })

  it("returns null for anything unusable rather than storing it bent", () => {
    expect(normalizeProductType("")).toBeNull()
    expect(normalizeProductType("   ")).toBeNull()
    expect(normalizeProductType("!!!")).toBeNull()
    expect(normalizeProductType(null)).toBeNull()
    expect(normalizeProductType(undefined)).toBeNull()
    expect(normalizeProductType(42)).toBeNull()
    expect(normalizeProductType({})).toBeNull()
  })

  it("refuses a sentence instead of truncating it to a plausible-looking type", () => {
    const sentence =
      "this design appears to be a pair of wide legged handwoven cotton trousers"
    expect(sentence.length).toBeGreaterThan(MAX_PRODUCT_TYPE_LENGTH)
    // Truncating would store "this_design_appears_to_be_a_pair_of..." as a
    // garment type, which reads like a real value to everything downstream.
    expect(normalizeProductType(sentence)).toBeNull()
  })

  it("collapses repeated separators", () => {
    expect(normalizeProductType("kurta   set")).toBe("kurta_set")
    expect(normalizeProductType("kurta___set")).toBe("kurta_set")
    expect(normalizeProductType("_kurta_")).toBe("kurta")
  })
})

describe("mayInferOver", () => {
  it("never lets a model overwrite a human's word", () => {
    expect(mayInferOver("manual")).toBe(false)
  })

  it("re-infers freely over its own previous guess", () => {
    expect(mayInferOver("inferred")).toBe(true)
    expect(mayInferOver(null)).toBe(true)
    expect(mayInferOver(undefined)).toBe(true)
  })

  it("lets an explicit force override a manual value — that is a person asking", () => {
    expect(mayInferOver("manual", true)).toBe(true)
  })
})
