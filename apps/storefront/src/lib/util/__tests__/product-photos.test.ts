import { describe, it, expect } from "vitest"
import { hasProductPhotos } from "../product-photos"

describe("hasProductPhotos", () => {
  it("is true when the product has images", () => {
    expect(
      hasProductPhotos({ thumbnail: null, images: [{ url: "https://cdn/a.jpg" }] })
    ).toBe(true)
  })

  it("is true with only a thumbnail", () => {
    expect(hasProductPhotos({ thumbnail: "https://cdn/t.jpg", images: [] })).toBe(true)
    expect(hasProductPhotos({ thumbnail: "https://cdn/t.jpg" })).toBe(true)
  })

  it("is true when a later image is usable and the first is blank", () => {
    expect(
      hasProductPhotos({ images: [{ url: "" }, { url: "https://cdn/b.jpg" }] })
    ).toBe(true)
  })

  it("is false with no photos at all", () => {
    expect(hasProductPhotos({})).toBe(false)
    expect(hasProductPhotos({ thumbnail: null, images: null })).toBe(false)
    expect(hasProductPhotos({ thumbnail: undefined, images: [] })).toBe(false)
  })

  it("is false for a missing product", () => {
    expect(hasProductPhotos(null)).toBe(false)
    expect(hasProductPhotos(undefined)).toBe(false)
  })

  it("is false when every url is blank or whitespace", () => {
    expect(hasProductPhotos({ thumbnail: "   ", images: [{ url: " \n\t" }] })).toBe(false)
    expect(hasProductPhotos({ thumbnail: "", images: [{ url: null }, null] })).toBe(false)
  })
})
