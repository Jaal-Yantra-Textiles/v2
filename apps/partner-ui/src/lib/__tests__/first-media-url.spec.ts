import { describe, expect, it } from "vitest"

import { firstMediaUrl, mediaUrls } from "../first-media-url"

describe("firstMediaUrl", () => {
  it("returns undefined for empty / null / undefined", () => {
    expect(firstMediaUrl(undefined)).toBeUndefined()
    expect(firstMediaUrl(null)).toBeUndefined()
    expect(firstMediaUrl({})).toBeUndefined()
    expect(firstMediaUrl([])).toBeUndefined()
    expect(firstMediaUrl({ files: [] })).toBeUndefined()
  })

  it("reads the canonical { files: string[] } prod shape", () => {
    expect(
      firstMediaUrl({ files: ["https://cdn/a.jpg", "https://cdn/b.jpg"] })
    ).toBe("https://cdn/a.jpg")
  })

  it("reads { files: [{ url }] } object entries", () => {
    expect(firstMediaUrl({ files: [{ url: "https://cdn/c.jpg" }] })).toBe(
      "https://cdn/c.jpg"
    )
  })

  it("reads a raw array of url strings", () => {
    expect(firstMediaUrl(["https://cdn/d.jpg"])).toBe("https://cdn/d.jpg")
  })

  it("reads a raw array of objects via url/file_path/thumbnail/src keys", () => {
    expect(firstMediaUrl([{ file_path: "https://cdn/e.jpg" }])).toBe(
      "https://cdn/e.jpg"
    )
    expect(firstMediaUrl([{ thumbnail: "https://cdn/f.jpg" }])).toBe(
      "https://cdn/f.jpg"
    )
    expect(firstMediaUrl([{ src: "https://cdn/g.jpg" }])).toBe("https://cdn/g.jpg")
  })

  it("reads a single { url } object", () => {
    expect(firstMediaUrl({ url: "https://cdn/h.jpg" })).toBe("https://cdn/h.jpg")
  })

  it("skips empty/whitespace entries and trims", () => {
    expect(firstMediaUrl({ files: ["", "   ", "https://cdn/i.jpg"] })).toBe(
      "https://cdn/i.jpg"
    )
    expect(firstMediaUrl(["  https://cdn/j.jpg  "])).toBe("https://cdn/j.jpg")
  })

  it("returns undefined when entries carry no usable url", () => {
    expect(firstMediaUrl({ files: [{ name: "no-url" }] })).toBeUndefined()
    expect(firstMediaUrl([42, false, {}])).toBeUndefined()
  })
})

describe("mediaUrls", () => {
  it("returns [] for empty / null", () => {
    expect(mediaUrls(null)).toEqual([])
    expect(mediaUrls({ files: [] })).toEqual([])
  })

  it("returns all urls from { files: [...] }", () => {
    expect(mediaUrls({ files: ["https://cdn/a.jpg", "https://cdn/b.jpg"] })).toEqual(
      ["https://cdn/a.jpg", "https://cdn/b.jpg"]
    )
  })

  it("returns all urls from a raw array of mixed shapes", () => {
    expect(
      mediaUrls(["https://cdn/a.jpg", { url: "https://cdn/b.jpg" }, { name: "x" }])
    ).toEqual(["https://cdn/a.jpg", "https://cdn/b.jpg"])
  })

  it("wraps a single object/string into a one-element array", () => {
    expect(mediaUrls({ url: "https://cdn/h.jpg" })).toEqual(["https://cdn/h.jpg"])
    expect(mediaUrls("https://cdn/s.jpg")).toEqual(["https://cdn/s.jpg"])
  })
})
