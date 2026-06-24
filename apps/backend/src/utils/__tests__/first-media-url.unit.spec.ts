import { firstMediaUrl } from "../first-media-url"

describe("firstMediaUrl (backend)", () => {
  it("returns undefined for empty / null / undefined", () => {
    expect(firstMediaUrl(undefined)).toBeUndefined()
    expect(firstMediaUrl(null)).toBeUndefined()
    expect(firstMediaUrl({})).toBeUndefined()
    expect(firstMediaUrl([])).toBeUndefined()
    expect(firstMediaUrl({ files: [] })).toBeUndefined()
  })

  it("reads the canonical { files: string[] } shape", () => {
    expect(firstMediaUrl({ files: ["https://cdn/a.jpg", "https://cdn/b.jpg"] })).toBe(
      "https://cdn/a.jpg"
    )
  })

  it("reads { files: [{ url }] } object entries", () => {
    expect(firstMediaUrl({ files: [{ url: "https://cdn/c.jpg" }] })).toBe("https://cdn/c.jpg")
  })

  it("reads a raw array of url strings", () => {
    expect(firstMediaUrl(["https://cdn/d.jpg"])).toBe("https://cdn/d.jpg")
  })

  it("reads a raw array of objects via url/file_path/thumbnail/src keys", () => {
    expect(firstMediaUrl([{ file_path: "https://cdn/e.jpg" }])).toBe("https://cdn/e.jpg")
    expect(firstMediaUrl([{ thumbnail: "https://cdn/f.jpg" }])).toBe("https://cdn/f.jpg")
    expect(firstMediaUrl([{ src: "https://cdn/g.jpg" }])).toBe("https://cdn/g.jpg")
  })

  it("reads a single object", () => {
    expect(firstMediaUrl({ url: "https://cdn/h.jpg" })).toBe("https://cdn/h.jpg")
  })

  it("skips empty/whitespace entries and trims", () => {
    expect(firstMediaUrl({ files: ["", "   ", "https://cdn/i.jpg"] })).toBe("https://cdn/i.jpg")
    expect(firstMediaUrl(["  https://cdn/j.jpg  "])).toBe("https://cdn/j.jpg")
  })

  it("returns undefined when entries carry no usable url", () => {
    expect(firstMediaUrl({ files: [{ name: "no-url" }] })).toBeUndefined()
    expect(firstMediaUrl([42, false, {}])).toBeUndefined()
  })
})
