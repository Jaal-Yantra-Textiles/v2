import { describe, expect, it, vi } from "vitest"

import { inlineMoodboardImages } from "../inline-moodboard-images"

const DATA = "data:image/png;base64,AAAA"

describe("inlineMoodboardImages", () => {
  it("replaces a remote url with the inlined data uri", async () => {
    const fetchDataUrl = vi.fn().mockResolvedValue(DATA)
    const res = await inlineMoodboardImages(
      { a: { dataURL: "https://cdn.test/x.png", mimeType: "image/png" } },
      fetchDataUrl
    )
    expect(res.files.a.dataURL).toBe(DATA)
    expect(res.files.a.mimeType).toBe("image/png")
    expect(res).toMatchObject({ inlined: 1, failed: 0 })
  })

  it("leaves an already-inline file alone and never calls the proxy", async () => {
    const fetchDataUrl = vi.fn()
    const res = await inlineMoodboardImages({ a: { dataURL: DATA } }, fetchDataUrl)
    expect(fetchDataUrl).not.toHaveBeenCalled()
    expect(res).toMatchObject({ inlined: 0, failed: 0 })
  })

  it("🔴 keeps the original url when inlining fails — the board still renders", async () => {
    const fetchDataUrl = vi.fn().mockRejectedValue(new Error("403"))
    const res = await inlineMoodboardImages(
      { a: { dataURL: "https://cdn.test/x.png" } },
      fetchDataUrl
    )
    expect(res.files.a.dataURL).toBe("https://cdn.test/x.png")
    expect(res).toMatchObject({ inlined: 0, failed: 1 })
  })

  it("🔑 fetches each DISTINCT url once, however many files share it", async () => {
    const fetchDataUrl = vi.fn().mockResolvedValue(DATA)
    const res = await inlineMoodboardImages(
      {
        front: { dataURL: "https://cdn.test/same.png" },
        back: { dataURL: "https://cdn.test/same.png" },
        other: { dataURL: "https://cdn.test/other.png" },
      },
      fetchDataUrl
    )
    expect(fetchDataUrl).toHaveBeenCalledTimes(2)
    expect(res.inlined).toBe(3)
  })

  it("handles an absent or empty files map", async () => {
    const fetchDataUrl = vi.fn()
    await expect(inlineMoodboardImages(undefined, fetchDataUrl)).resolves.toMatchObject({
      inlined: 0,
      failed: 0,
    })
    await expect(inlineMoodboardImages({}, fetchDataUrl)).resolves.toMatchObject({
      inlined: 0,
    })
  })
})
