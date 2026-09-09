/**
 * #1920 — consolidating the mint doors must not cost the catalogue its photos.
 *
 * `promote-design-to-product` sourced a product's WHOLE gallery from the
 * design's linked media folder; `create-product-from-design`, the door that
 * survives, only ever had `thumbnail_url`. This is the ported behaviour, plus
 * the one thing that deliberately did NOT come along: the retired door REFUSED
 * to mint without a folder, and here the folder is a source, not a gate.
 */

import { resolveDesignGallery } from "../create-product-from-design"

describe("resolveDesignGallery", () => {
  it("takes every image in the linked folder, first one as the thumbnail", () => {
    const g = resolveDesignGallery({
      thumbnail_url: "https://cdn/thumb.jpg",
      folders: [
        {
          media_files: [
            { file_path: "https://cdn/a.jpg", file_type: "image" },
            { file_path: "https://cdn/b.jpg", file_type: "image" },
            { file_path: "https://cdn/c.jpg", file_type: "image" },
          ],
        },
      ],
    })

    expect(g.thumbnail).toBe("https://cdn/a.jpg")
    expect(g.images).toEqual([
      { url: "https://cdn/a.jpg" },
      { url: "https://cdn/b.jpg" },
      { url: "https://cdn/c.jpg" },
    ])
  })

  it("counts a file as an image on EITHER signal — the two upload paths set different ones", () => {
    const g = resolveDesignGallery({
      folders: [
        {
          media_files: [
            { file_path: "https://cdn/typed.jpg", file_type: "image" },
            { file_path: "https://cdn/mimed.png", mime_type: "image/png" },
          ],
        },
      ],
    })

    expect(g.images).toHaveLength(2)
  })

  it("ignores non-images in the folder rather than putting a PDF in the gallery", () => {
    const g = resolveDesignGallery({
      thumbnail_url: null,
      folders: [
        {
          media_files: [
            { file_path: "https://cdn/spec.pdf", file_type: "document", mime_type: "application/pdf" },
            { file_path: "https://cdn/real.jpg", file_type: "image" },
          ],
        },
      ],
    })

    expect(g.images).toEqual([{ url: "https://cdn/real.jpg" }])
    expect(g.thumbnail).toBe("https://cdn/real.jpg")
  })

  it("falls back to thumbnail_url when the folder holds no images — it does NOT refuse", () => {
    const g = resolveDesignGallery({
      thumbnail_url: "https://cdn/thumb.jpg",
      folders: [{ media_files: [{ file_path: "https://cdn/spec.pdf", file_type: "document" }] }],
    })

    expect(g.thumbnail).toBe("https://cdn/thumb.jpg")
    expect(g.images).toEqual([{ url: "https://cdn/thumb.jpg" }])
  })

  it("falls back to thumbnail_url when there is no folder at all", () => {
    expect(resolveDesignGallery({ thumbnail_url: "https://cdn/t.jpg" })).toEqual({
      thumbnail: "https://cdn/t.jpg",
      images: [{ url: "https://cdn/t.jpg" }],
    })
  })

  it("mints with NO image rather than refusing — a design with neither is ordinary here", () => {
    expect(resolveDesignGallery({ thumbnail_url: null, folders: [] })).toEqual({
      thumbnail: undefined,
      images: [],
    })
  })

  it("treats an empty-string thumbnail_url as absent, not as an image", () => {
    // '' is not a URL. It would render as a broken image everywhere.
    expect(resolveDesignGallery({ thumbnail_url: "" })).toEqual({
      thumbnail: undefined,
      images: [],
    })
  })

  it("drops a folder file with no file_path instead of emitting {url: undefined}", () => {
    const g = resolveDesignGallery({
      thumbnail_url: "https://cdn/thumb.jpg",
      folders: [{ media_files: [{ file_type: "image" }, { file_path: "https://cdn/ok.jpg", file_type: "image" }] }],
    })

    expect(g.images).toEqual([{ url: "https://cdn/ok.jpg" }])
  })
})
