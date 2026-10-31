import { describe, expect, it } from "vitest"

import imageLoader from "../image-loader"

const HOST = "https://automatic.jaalyantra.com"

describe("imageLoader — Cloudflare host", () => {
  it("wraps a plain source path once", () => {
    expect(
      imageLoader({ src: `${HOST}/automatica/IMG_1.jpg`, width: 640 })
    ).toBe(`${HOST}/cdn-cgi/image/width=640,quality=85,format=auto/automatica/IMG_1.jpg`)
  })

  it("does not nest a transform inside a stored transform URL (CF 404s that)", () => {
    expect(
      imageLoader({
        src: `${HOST}/cdn-cgi/image/format=jpeg,width=1600/automatica/IMG_0876-7366319671ab2341.heic`,
        width: 1200,
      })
    ).toBe(
      `${HOST}/cdn-cgi/image/width=1200,quality=85,format=auto/automatica/IMG_0876-7366319671ab2341.heic`
    )
  })

  it("strips repeated stored prefixes", () => {
    expect(
      imageLoader({
        src: `${HOST}/cdn-cgi/image/width=10/cdn-cgi/image/format=jpeg/automatica/a.HEIC`,
        width: 320,
        quality: 70,
      })
    ).toBe(`${HOST}/cdn-cgi/image/width=320,quality=70,format=auto/automatica/a.HEIC`)
  })
})

describe("imageLoader — other hosts", () => {
  it("leaves relative paths alone", () => {
    expect(imageLoader({ src: "/favicon.ico", width: 32 })).toBe("/favicon.ico")
  })

  it("routes foreign hosts through the Vercel optimizer", () => {
    expect(imageLoader({ src: "https://example.com/a.png", width: 100 })).toBe(
      "/_next/image?url=https%3A%2F%2Fexample.com%2Fa.png&w=100&q=85"
    )
  })
})
