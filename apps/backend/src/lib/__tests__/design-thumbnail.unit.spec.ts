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

  /**
   * Found on prod: a design whose only media file was a phone upload,
   * `IMG_0701-….HEIC`. The summary returned it, the `<img>` could not decode
   * it in Chrome, and the row looked exactly like a design with no picture.
   */
  it("skips formats an <img> cannot decode, falling through to one it can", () => {
    expect(
      resolveDesignThumbnail({
        media_files: [
          { url: "https://cdn/automatica/IMG_0701-21f20092.HEIC" },
          { url: "https://cdn/automatica/PXL_20260621.jpg" },
        ],
      })
    ).toBe("https://cdn/automatica/PXL_20260621.jpg")
  })

  it("prefers a renderable file over a FLAGGED unrenderable one", () => {
    // The flag says "this is the thumbnail", but a picture nobody can see is
    // worse than the next one down.
    expect(
      resolveDesignThumbnail({
        media_files: [
          { url: "https://cdn/shot.heif", isThumbnail: true },
          { url: "https://cdn/shot.jpeg" },
        ],
      })
    ).toBe("https://cdn/shot.jpeg")
  })

  it("returns null when every candidate is unrenderable", () => {
    // The honest placeholder, rather than a broken-image box.
    expect(
      resolveDesignThumbnail({
        media_files: [{ url: "https://cdn/only.HEIC" }],
      })
    ).toBeNull()
  })

  it("ignores a query string when reading the extension", () => {
    expect(
      resolveDesignThumbnail({
        media_files: [{ url: "https://cdn/a.heic?v=2" }, { url: "https://cdn/b.png" }],
      })
    ).toBe("https://cdn/b.png")
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

describe("resolveDesignThumbnail — design.thumbnail_url (#cart-thumbnail)", () => {
  it("uses thumbnail_url when no media file is flagged", () => {
    expect(
      resolveDesignThumbnail({
        thumbnail_url: "https://cdn.example.com/stamped.png",
        media_files: [{ url: "https://cdn.example.com/other.png" }],
      })
    ).toBe("https://cdn.example.com/stamped.png")
  })

  /**
   * 🔴 Measured before shipping: 4 of 15 live designs carry BOTH. Reordering
   * would silently repaint those 4 — including in the partner order list, which
   * already calls this — so the flag keeps precedence.
   */
  it("does NOT outrank a flagged media file", () => {
    expect(
      resolveDesignThumbnail({
        thumbnail_url: "https://cdn.example.com/stamped.png",
        media_files: [
          { url: "https://cdn.example.com/flagged.png", isThumbnail: true },
        ],
      })
    ).toBe("https://cdn.example.com/flagged.png")
  })

  it("outranks metadata.thumbnail and an unflagged media file", () => {
    expect(
      resolveDesignThumbnail({
        thumbnail_url: "https://cdn.example.com/stamped.png",
        metadata: { thumbnail: "https://cdn.example.com/meta.png" },
        media_files: [{ url: "https://cdn.example.com/first.png" }],
      })
    ).toBe("https://cdn.example.com/stamped.png")
  })

  it("falls through when thumbnail_url is blank or unrenderable", () => {
    expect(
      resolveDesignThumbnail({
        thumbnail_url: "   ",
        metadata: { thumbnail: "https://cdn.example.com/meta.png" },
      })
    ).toBe("https://cdn.example.com/meta.png")

    expect(
      resolveDesignThumbnail({
        thumbnail_url: "https://cdn.example.com/photo.heic",
        metadata: { thumbnail: "https://cdn.example.com/meta.png" },
      })
    ).toBe("https://cdn.example.com/meta.png")
  })
})

/**
 * The real prod row for "Tibetan Chupa Style Shirt"
 * (01M2QDA0VWZXX9PK07317PT6WN) after a media-file upload on 2026-09-20 —
 * the design on the live €182 Swedish order whose checkout showed a grey
 * placeholder. Kept verbatim so the shape the upload actually writes is
 * pinned, not the shape we assumed it writes.
 */
describe("resolveDesignThumbnail — the live design-order row", () => {
  const URL =
    "https://automatic.jaalyantra.com/automatica/fece54202714d4d384684d69674b7523-01M2Y46SSAFFAH8PX3JZCE6JYJ.jpg"

  it("resolves the uploaded media file", () => {
    expect(
      resolveDesignThumbnail({
        thumbnail_url: null,
        media_files: [
          {
            id: "fece54202714d4d384684d69674b7523-01M2Y46SSAFFAH8PX3JZCE6JYJ.jpg",
            url: URL,
            isThumbnail: true,
          },
        ],
        metadata: { thumbnail: URL },
        moodboard: null,
      })
    ).toBe(URL)
  })
})
