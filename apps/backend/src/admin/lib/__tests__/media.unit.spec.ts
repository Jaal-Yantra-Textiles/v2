import { displayUrl, isImageUrl } from "../media"

const HEIC = "https://automatic.jaalyantra.com/automatica/IMG_9648.heic"
const JPG = "https://automatic.jaalyantra.com/automatica/IMG_0066.jpeg"

describe("admin media URLs (#2587)", () => {
  it("treats iPhone HEIC/HEIF photos as images, any case", () => {
    expect(isImageUrl(HEIC)).toBe(true)
    expect(isImageUrl("https://x.test/a/B.HEIF")).toBe(true)
  })

  it("still says no to video and documents", () => {
    expect(isImageUrl("https://x.test/a/IMG_0088.mov")).toBe(false)
    expect(isImageUrl("https://x.test/a/bill.pdf")).toBe(false)
  })

  it("serves HEIC through Cloudflare's converter, since browsers cannot draw it", () => {
    expect(displayUrl(HEIC)).toBe(
      "https://automatic.jaalyantra.com/cdn-cgi/image/width=1600,quality=85,fit=scale-down/automatica/IMG_9648.heic"
    )
  })

  it("leaves formats a browser can draw untouched", () => {
    expect(displayUrl(JPG)).toBe(JPG)
    expect(displayUrl(undefined)).toBe("")
  })
})
