import {
  MAX_PRODUCT_TYPE_LENGTH,
  mayInferOver,
  normalizeProductType,
  parseInferredProductType,
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

describe("parseInferredProductType", () => {
  it("prefers a structured object when the model honoured the schema", () => {
    expect(
      parseInferredProductType({
        object: { product_type: "Trousers", confidence: 0.9, reasoning: "named" },
      })
    ).toEqual({ product_type: "trousers", confidence: 0.9, reasoning: "named" })
  })

  it("reads markdown prose — the shape that broke this in real life", () => {
    // Verbatim from `stealth/ox-alpha` via dynamicFreeTextModel: a correct
    // answer with `response.object` UNDEFINED. Reading `.object` alone threw
    // on every call, and the mocked integration tests could not see it.
    const text =
      '**product_type:** trousers\n\n**confidence:** 0.97\n\n**reasoning:** The design is explicitly named "Summer Trousers".'
    expect(parseInferredProductType({ text })).toEqual({
      product_type: "trousers",
      confidence: 0.97,
      reasoning: 'The design is explicitly named "Summer Trousers".',
    })
  })

  it("reads plain labelled prose without markdown bold", () => {
    const text = "product_type: cushion_cover\nconfidence: 0.8\nreasoning: stated"
    expect(parseInferredProductType({ text })?.product_type).toBe("cushion_cover")
    expect(parseInferredProductType({ text })?.confidence).toBe(0.8)
  })

  it("reads JSON out of the text, fenced or bare", () => {
    const fenced =
      '```json\n{"product_type":"saree","confidence":0.98,"reasoning":"named"}\n```'
    expect(parseInferredProductType({ text: fenced })).toEqual({
      product_type: "saree",
      confidence: 0.98,
      reasoning: "named",
    })

    const bare =
      'Here you go: {"product_type":"kurta","confidence":0.95,"reasoning":"named"} — hope that helps'
    expect(parseInferredProductType({ text: bare })?.product_type).toBe("kurta")
  })

  it("finds the matching brace rather than the first one, so nesting does not truncate", () => {
    const text =
      '{"product_type":"stole","confidence":0.7,"reasoning":"see {details: here} inline"}'
    expect(parseInferredProductType({ text })?.product_type).toBe("stole")
  })

  it("falls back to text when object is present but unusable", () => {
    // A model can return a malformed `object` AND a good text body.
    expect(
      parseInferredProductType({
        object: { product_type: "", confidence: 0.9 },
        text: '{"product_type":"blouse","confidence":0.9}',
      })?.product_type
    ).toBe("blouse")
  })

  it("returns null rather than a guess when nothing usable is there", () => {
    expect(parseInferredProductType({})).toBeNull()
    expect(parseInferredProductType({ text: "" })).toBeNull()
    expect(parseInferredProductType({ text: "I am not sure what this is." })).toBeNull()
    expect(parseInferredProductType({ text: "confidence: 0.9" })).toBeNull()
  })

  it("rejects a confidence outside 0-1 instead of storing a bent number", () => {
    expect(
      parseInferredProductType({ object: { product_type: "shirt", confidence: 7 } })
    ).toBeNull()
    expect(
      parseInferredProductType({ object: { product_type: "shirt", confidence: -1 } })
    ).toBeNull()
    expect(
      parseInferredProductType({ object: { product_type: "shirt", confidence: "high" } })
    ).toBeNull()
  })

  it("defaults an unstated confidence to the floor, never above it", () => {
    // A prose answer that named a garment but no confidence is still a real
    // answer — but it must not outrank a model that stated a low one.
    const parsed = parseInferredProductType({ text: "product_type: jacket" })
    expect(parsed?.product_type).toBe("jacket")
    expect(parsed?.confidence).toBe(0.6)
  })
})
