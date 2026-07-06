import {
  OutlineBodySchema,
  buildPotraceParams,
  decodeImageBase64,
  svgToDataUrl,
  parseSvgDimensions,
  MOCK_OUTLINE_SVG,
} from "../outline-support"

describe("#892 /outline — pure helpers", () => {
  describe("OutlineBodySchema", () => {
    it("applies defaults for a minimal valid body", () => {
      const r = OutlineBodySchema.parse({ image_url: "https://cdn.example.com/flat.png" })
      expect(r.mode).toBe("outline")
      expect(r.threshold).toBe(-1)
      expect(r.turd_size).toBe(2)
      expect(r.opt_tolerance).toBeCloseTo(0.2)
      expect(r.black_on_white).toBe(true)
      expect(r.color).toBe("black")
      expect(r.background).toBe("transparent")
    })

    it("rejects a body with neither image_url nor image_base64", () => {
      const r = OutlineBodySchema.safeParse({ mode: "outline" })
      expect(r.success).toBe(false)
    })

    it("accepts image_base64 alone", () => {
      const r = OutlineBodySchema.safeParse({ image_base64: "data:image/png;base64,AAAA" })
      expect(r.success).toBe(true)
    })

    it("rejects an out-of-range threshold", () => {
      expect(OutlineBodySchema.safeParse({ image_url: "https://x/y.png", threshold: 999 }).success).toBe(false)
      expect(OutlineBodySchema.safeParse({ image_url: "https://x/y.png", threshold: -2 }).success).toBe(false)
    })

    it("rejects a non-URL image_url", () => {
      expect(OutlineBodySchema.safeParse({ image_url: "not a url" }).success).toBe(false)
    })
  })

  describe("buildPotraceParams", () => {
    const base = OutlineBodySchema.parse({ image_url: "https://x/y.png" })

    it("omits threshold when auto (-1) and includes shared options", () => {
      const p = buildPotraceParams(base)
      expect(p).not.toHaveProperty("threshold")
      expect(p).toMatchObject({
        turdSize: 2,
        optTolerance: 0.2,
        blackOnWhite: true,
        color: "black",
        background: "transparent",
      })
      expect(p).not.toHaveProperty("steps")
    })

    it("pins threshold when the caller sets one", () => {
      const p = buildPotraceParams({ ...base, threshold: 128 })
      expect(p.threshold).toBe(128)
    })

    it("adds steps only in posterize mode", () => {
      const p = buildPotraceParams({ ...base, mode: "posterize", steps: 4 })
      expect(p.steps).toBe(4)
    })

    it("passes black_on_white:false through (mask input)", () => {
      const p = buildPotraceParams({ ...base, black_on_white: false })
      expect(p.blackOnWhite).toBe(false)
    })
  })

  describe("decodeImageBase64", () => {
    it("decodes a data URL and keeps its mime type", () => {
      const { buffer, mimeType } = decodeImageBase64("data:image/jpeg;base64,QUJD")
      expect(mimeType).toBe("image/jpeg")
      expect(buffer.toString("utf8")).toBe("ABC")
    })

    it("decodes a bare base64 blob as png", () => {
      const { buffer, mimeType } = decodeImageBase64("QUJD")
      expect(mimeType).toBe("image/png")
      expect(buffer.toString("utf8")).toBe("ABC")
    })
  })

  describe("svgToDataUrl", () => {
    it("round-trips svg markup through a base64 data URL", () => {
      const url = svgToDataUrl(MOCK_OUTLINE_SVG)
      expect(url.startsWith("data:image/svg+xml;base64,")).toBe(true)
      const b64 = url.split(",")[1]
      expect(Buffer.from(b64, "base64").toString("utf8")).toBe(MOCK_OUTLINE_SVG)
    })
  })

  describe("parseSvgDimensions", () => {
    it("reads width/height off the root svg", () => {
      expect(parseSvgDimensions(MOCK_OUTLINE_SVG)).toEqual({ width: 100, height: 100 })
    })

    it("returns nulls when absent", () => {
      expect(parseSvgDimensions("<svg><path d=\"M0 0\"/></svg>")).toEqual({
        width: null,
        height: null,
      })
    })
  })
})
