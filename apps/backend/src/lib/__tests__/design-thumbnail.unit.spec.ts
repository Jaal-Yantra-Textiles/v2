import {
  resolveDesignThumbnail,
  resolveMoodboardFirstImage,
} from "../design-thumbnail"

describe("resolveDesignThumbnail", () => {
  it("prefers the media file flagged as the thumbnail", () => {
    expect(
      resolveDesignThumbnail({
        media_files: [
          { url: "https://cdn/first.png" },
          { url: "https://cdn/flagged.png", isThumbnail: true },
        ],
        metadata: { thumbnail: "https://cdn/meta.png" },
      })
    ).toBe("https://cdn/flagged.png")
  })

  it("falls back to metadata.thumbnail when no media file is flagged", () => {
    expect(
      resolveDesignThumbnail({
        media_files: [{ url: "https://cdn/first.png" }],
        metadata: { thumbnail: "https://cdn/meta.png" },
      })
    ).toBe("https://cdn/meta.png")
  })

  it("falls back to the first usable media file", () => {
    expect(
      resolveDesignThumbnail({
        media_files: [{ url: "  " }, { url: "https://cdn/first.png" }],
      })
    ).toBe("https://cdn/first.png")
  })

  it("falls back to the moodboard's first reference image", () => {
    expect(
      resolveDesignThumbnail({
        media_files: [],
        moodboard: {
          elements: [
            { type: "text", id: "t1" },
            { type: "image", id: "i1", fileId: "f1" },
            { type: "image", id: "i2", fileId: "f2" },
          ],
          files: {
            f1: { dataURL: "https://cdn/moodboard-1.png" },
            f2: { dataURL: "https://cdn/moodboard-2.png" },
          },
        },
      })
    ).toBe("https://cdn/moodboard-1.png")
  })

  it("returns null for a design with no pictures anywhere", () => {
    expect(resolveDesignThumbnail({})).toBeNull()
    expect(resolveDesignThumbnail(null)).toBeNull()
  })

  it("skips base64 data URLs unless the caller opts in", () => {
    const design = {
      media_files: [{ url: "data:image/png;base64,AAAA" }],
    }
    expect(resolveDesignThumbnail(design)).toBeNull()
    expect(resolveDesignThumbnail(design, { allowDataUrl: true })).toBe(
      "data:image/png;base64,AAAA"
    )
  })
})

describe("resolveMoodboardFirstImage", () => {
  it("skips deleted elements and images whose file is missing", () => {
    expect(
      resolveMoodboardFirstImage({
        elements: [
          { type: "image", fileId: "gone" },
          { type: "image", fileId: "f1", isDeleted: true },
          { type: "image", fileId: "f2" },
        ],
        files: {
          f1: { dataURL: "https://cdn/deleted.png" },
          f2: { dataURL: "https://cdn/kept.png" },
        },
      })
    ).toBe("https://cdn/kept.png")
  })

  it("returns null for a scene with no files or no elements", () => {
    expect(resolveMoodboardFirstImage({ elements: [] })).toBeNull()
    expect(resolveMoodboardFirstImage({ files: {} })).toBeNull()
    expect(resolveMoodboardFirstImage(null)).toBeNull()
  })
})
