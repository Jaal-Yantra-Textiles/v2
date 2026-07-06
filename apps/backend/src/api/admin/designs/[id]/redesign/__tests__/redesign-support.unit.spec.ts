/**
 * Unit tests — redesign-support (#892). Pure helpers: body validation, prompt
 * wrapping, image-input resolution, and file→data-url normalization.
 *
 * Run: TEST_TYPE=unit npx jest --testPathPattern="redesign-support"
 */
import {
  RedesignBodySchema,
  buildRedesignPrompt,
  fileToDataUrl,
  resolveImageInput,
} from "../redesign-support"

describe("RedesignBodySchema", () => {
  it("accepts an image_url + prompt", () => {
    const r = RedesignBodySchema.safeParse({
      image_url: "https://cdn.example.com/flat.png",
      prompt: "add piping",
    })
    expect(r.success).toBe(true)
  })

  it("accepts image_base64 + prompt", () => {
    const r = RedesignBodySchema.safeParse({
      image_base64: "data:image/png;base64,AAAA",
      prompt: "add piping",
    })
    expect(r.success).toBe(true)
  })

  it("rejects when no image is provided", () => {
    const r = RedesignBodySchema.safeParse({ prompt: "add piping" })
    expect(r.success).toBe(false)
  })

  it("rejects an empty prompt", () => {
    const r = RedesignBodySchema.safeParse({
      image_url: "https://cdn.example.com/flat.png",
      prompt: "   ",
    })
    expect(r.success).toBe(false)
  })
})

describe("buildRedesignPrompt", () => {
  it("wraps the user direction in a structure-preserving instruction", () => {
    const p = buildRedesignPrompt("make it linen with a mandarin collar")
    expect(p).toContain("make it linen with a mandarin collar")
    expect(p.toLowerCase()).toContain("preserve")
    expect(p.toLowerCase()).toContain("silhouette")
  })

  it("trims the user prompt", () => {
    expect(buildRedesignPrompt("  hello  ")).toContain("Apply this design direction: hello.")
  })
})

describe("resolveImageInput", () => {
  it("prefers an http URL verbatim", () => {
    expect(resolveImageInput({ image_url: "https://x/y.png" })).toBe("https://x/y.png")
  })
  it("passes a data URL through", () => {
    expect(resolveImageInput({ image_base64: "data:image/png;base64,AAAA" })).toBe(
      "data:image/png;base64,AAAA"
    )
  })
  it("promotes a bare base64 blob to a png data URL", () => {
    expect(resolveImageInput({ image_base64: "AAAA" })).toBe("data:image/png;base64,AAAA")
  })
})

describe("fileToDataUrl", () => {
  it("prefixes a bare base64 with its media type", () => {
    expect(fileToDataUrl({ mediaType: "image/webp", base64: "AAAA" })).toBe(
      "data:image/webp;base64,AAAA"
    )
  })
  it("leaves an existing data URL untouched", () => {
    expect(fileToDataUrl({ base64: "data:image/png;base64,BBBB" })).toBe(
      "data:image/png;base64,BBBB"
    )
  })
})
