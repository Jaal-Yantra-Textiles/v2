import {
  formatDimensions,
  resolveLineSize,
  sizeFromProduct,
  sizeFromSpec,
  sizeFromVariant,
} from "../lib/quote-size"

/**
 * "How big is the thing I am buying?"
 *
 * A quote stated the ends-per-inch and the GSM and never the size of the piece,
 * because the three places a partner may have written it down were all invisible
 * to this payload.
 */
describe("formatDimensions", () => {
  it("states both dimensions with a unit", () => {
    expect(formatDimensions(200, 70)).toBe("200 × 70 cm")
  })

  it("still says something with only one dimension", () => {
    // A 200 cm stole of unstated width tells a buyer more than nothing does.
    expect(formatDimensions(200, null)).toBe("200 cm")
    expect(formatDimensions(null, 70)).toBe("70 cm")
  })

  it("🔴 treats 0 and junk as ABSENT, not as a measurement", () => {
    // Both arrive from the database looking plausible on a row nobody filled
    // in, and both would render as "0 × 0 cm" beside a price.
    expect(formatDimensions(0, 0)).toBeNull()
    expect(formatDimensions("", null)).toBeNull()
    expect(formatDimensions("abc", null)).toBeNull()
    expect(formatDimensions(undefined, undefined)).toBeNull()
  })
})

describe("sizeFromVariant", () => {
  const variant = (title: string, value: string) => ({
    options: [{ value, option: { title } }],
  })

  it("reads the value of a size-ish option", () => {
    expect(sizeFromVariant(variant("Size", "200 × 70 cm"))).toBe("200 × 70 cm")
    expect(sizeFromVariant(variant("Dimensions", "King"))).toBe("King")
  })

  it("is case- and whitespace-insensitive about the option title", () => {
    expect(sizeFromVariant(variant("  SIZE ", "Stole"))).toBe("Stole")
  })

  it("ignores options that are not about size", () => {
    expect(sizeFromVariant(variant("Colour", "Rust"))).toBeNull()
    expect(sizeFromVariant({ options: [] })).toBeNull()
    expect(sizeFromVariant(undefined)).toBeNull()
  })
})

describe("sizeFromSpec", () => {
  it("joins the trade name to the measurement", () => {
    expect(
      sizeFromSpec({
        size_label: "Stole",
        finished_length_cm: 200,
        finished_width_cm: 70,
      })
    ).toBe("Stole · 200 × 70 cm")
  })

  it("says whichever half exists", () => {
    // A buyer who knows "Stole" does not want to decode 200 × 70; one who does
    // not know the word needs the numbers. Either alone still helps.
    expect(sizeFromSpec({ size_label: "Stole" })).toBe("Stole")
    expect(
      sizeFromSpec({ finished_length_cm: 200, finished_width_cm: 70 })
    ).toBe("200 × 70 cm")
  })

  it("is null on a spec that states no size", () => {
    expect(sizeFromSpec({ weave_technique: "twill" })).toBeNull()
    expect(sizeFromSpec(null)).toBeNull()
  })

  it("🔴 never reads loom width as the finished size", () => {
    // Different measurement: the cloth ON the loom, before it is cut, hemmed
    // and washed. Quoting it as the article's size overstates it every time.
    expect(sizeFromSpec({ params: { loom_width_cm: 90 } })).toBeNull()
  })
})

describe("sizeFromProduct", () => {
  it("reads the catalogue dimensions the product page already shows", () => {
    expect(sizeFromProduct({ length: 200, width: 70 })).toBe("200 × 70 cm")
  })

  it("is null on the catalogue's usual state — nothing filled in", () => {
    expect(sizeFromProduct({ length: null, width: null })).toBeNull()
  })
})

describe("resolveLineSize", () => {
  it("prefers the VARIANT — it is the SKU being quoted", () => {
    const size = resolveLineSize({
      variant: { options: [{ value: "Full shawl", option: { title: "Size" } }] },
      spec_size: "Stole · 200 × 70 cm",
      product: { length: 111, width: 11 },
    })
    expect(size).toEqual({ label: "Full shawl", source: "variant" })
  })

  it("falls back to the spec when size is not an option", () => {
    const size = resolveLineSize({
      variant: { options: [{ value: "Rust", option: { title: "Colour" } }] },
      spec_size: "Stole · 200 × 70 cm",
      product: { length: 111, width: 11 },
    })
    expect(size).toEqual({ label: "Stole · 200 × 70 cm", source: "spec" })
  })

  it("falls back to the product's catalogue dimensions last", () => {
    const size = resolveLineSize({
      variant: { options: [] },
      spec_size: null,
      product: { length: 200, width: 70 },
    })
    // Weakest claim, and it is labelled one so the page can caveat it — the
    // same treatment `image_source` and `weight_source` get.
    expect(size).toEqual({ label: "200 × 70 cm", source: "product" })
  })

  it("is null when nobody stated a size anywhere", () => {
    expect(
      resolveLineSize({ variant: { options: [] }, spec_size: null, product: {} })
    ).toBeNull()
  })
})
