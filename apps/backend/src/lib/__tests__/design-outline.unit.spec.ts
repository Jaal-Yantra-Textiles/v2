import {
  DESIGN_OUTLINE_URLS,
  designGarmentKind,
  isDesignOutlineUrl,
  resolveDesignImage,
} from "../design-outline"

describe("designGarmentKind", () => {
  it.each([
    ["Chirag – Trouser, Navy Kala cotton with white weft stripes", "trouser"],
    ["Grey Merino Wool Shirt with Lion Embroidery", "shirt"],
    ["Sreeni Vasan – Shirts x3 (1 silk, 2 linen)", "shirt"],
    ["Tibetan Chupa Style Shirt", "shirt"],
    ["Unlined & Unhurried Kurta", "shirt"],
    ["Wrap Midi Dress in Muslin", "dress"],
    ["Linen shirt dress", "dress"],
    ["Organic cotton t-shirt", "tshirt"],
    ["Sreeni Vasan – Small rajai, cream kala cotton", "quilt"],
    ["Round crossbody bag", "bag"],
    ["Silk Jacket", "garment"],
    ["Barako Apron — Black 8-ply", "garment"],
    ["Short sleeve shirt", "shirt"],
    ["Pantone swatch card", "garment"],
  ])("%s → %s", (name, kind) => {
    expect(designGarmentKind({ name })).toBe(kind)
  })

  it("prefers the typed product_type over the name", () => {
    expect(designGarmentKind({ product_type: "trousers", name: "Luong Shirt" })).toBe("trouser")
    expect(designGarmentKind({ product_type: "palazzo_pants", name: "x" })).toBe("trouser")
  })

  it("falls back to the name when product_type says nothing", () => {
    expect(designGarmentKind({ product_type: "custom", name: "Butterfly Shirt" })).toBe("shirt")
  })

  it("is the coat hanger for nothing at all", () => {
    expect(designGarmentKind(null)).toBe("garment")
    expect(designGarmentKind({})).toBe("garment")
  })
})

describe("resolveDesignImage", () => {
  it("keeps the design's own picture when it has one", () => {
    const own = "https://example.com/real.jpg"
    expect(resolveDesignImage({ name: "Trouser", thumbnail_url: own })).toBe(own)
  })

  it("uses the garment outline when the design has no picture", () => {
    const url = resolveDesignImage({ name: "Chirag – Trouser", media_files: [] })
    expect(url).toBe(DESIGN_OUTLINE_URLS.trouser)
    expect(isDesignOutlineUrl(url)).toBe(true)
  })

  it("skips an image the browser cannot render and falls to the outline", () => {
    expect(resolveDesignImage({ name: "Kurta", media_files: [{ url: "https://x/y.HEIC" }] })).toBe(
      DESIGN_OUTLINE_URLS.shirt
    )
  })

  it("does not treat a real photo as an outline", () => {
    expect(isDesignOutlineUrl("https://example.com/real.jpg")).toBe(false)
    expect(isDesignOutlineUrl(null)).toBe(false)
  })

  it("has a distinct hosted URL per kind", () => {
    const urls = Object.values(DESIGN_OUTLINE_URLS)
    expect(new Set(urls).size).toBe(urls.length)
    for (const u of urls) expect(u).toMatch(/^https:\/\/.+\.png$/)
  })
})
