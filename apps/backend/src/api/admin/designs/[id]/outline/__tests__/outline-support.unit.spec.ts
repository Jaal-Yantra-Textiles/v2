import {
  OutlineBodySchema,
  buildTracerOptions,
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

  describe("buildTracerOptions", () => {
    const base = OutlineBodySchema.parse({ image_url: "https://x/y.png" })

    it("quantizes to 2 colours in outline mode and maps despeckle/tolerance", () => {
      const p = buildTracerOptions(base)
      expect(p.numberofcolors).toBe(2)
      expect(p.pathomit).toBe(2) // turd_size default
      expect(p.ltres).toBeCloseTo(1.0) // opt_tolerance 0.2 * 5
      expect(p.qtres).toBeCloseTo(1.0)
      expect(p.linefilter).toBe(true)
    })

    it("uses `steps` colours in posterize mode", () => {
      const p = buildTracerOptions({ ...base, mode: "posterize", steps: 4 })
      expect(p.numberofcolors).toBe(4)
    })

    it("maps a larger turd_size to pathomit", () => {
      const p = buildTracerOptions({ ...base, turd_size: 20 })
      expect(p.pathomit).toBe(20)
    })

    it("scales opt_tolerance into ltres/qtres", () => {
      const p = buildTracerOptions({ ...base, opt_tolerance: 0.4 })
      expect(p.ltres).toBeCloseTo(2.0)
      expect(p.qtres).toBeCloseTo(2.0)
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
