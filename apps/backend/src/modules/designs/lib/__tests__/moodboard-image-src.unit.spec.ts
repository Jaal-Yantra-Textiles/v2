/**
 * The moodboard image proxy's SSRF gate (#2228).
 *
 * This is the only part of the proxy where a mistake is a security bug rather
 * than a broken picture, so the cases below are the attacks, not the happy path.
 */
import {
  allowedImageOrigins,
  checkImageSrc,
  isInlinableImageType,
} from "../moodboard-image-src"

const CDN = "https://automatic.jaalyantra.com"
const SELF = "http://localhost:9000"
const ORIGINS = [CDN, SELF]

describe("allowedImageOrigins", () => {
  it("takes the ORIGIN of each configured URL, dropping any path", () => {
    expect(
      allowedImageOrigins({
        S3_FILE_URL: "https://automatic.jaalyantra.com/uploads/",
        MEDUSA_BACKEND_URL: "http://localhost:9000",
      })
    ).toEqual([CDN, SELF])
  })

  it("is empty when nothing is configured — the proxy fetches NOTHING by default", () => {
    expect(allowedImageOrigins({})).toEqual([])
    expect(allowedImageOrigins({ S3_FILE_URL: "" })).toEqual([])
  })

  it("a malformed config value contributes nothing and does not throw", () => {
    expect(
      allowedImageOrigins({ S3_FILE_URL: "not a url", MEDUSA_BACKEND_URL: SELF })
    ).toEqual([SELF])
  })

  it("de-duplicates when both point at the same origin", () => {
    expect(
      allowedImageOrigins({ S3_FILE_URL: SELF + "/static", MEDUSA_BACKEND_URL: SELF })
    ).toEqual([SELF])
  })
})

describe("checkImageSrc", () => {
  it("allows an image on the configured CDN", () => {
    const v = checkImageSrc(`${CDN}/uploads/flat.png`, ORIGINS)
    expect(v.ok).toBe(true)
  })

  it("🔴 refuses a look-alike host that merely starts with an allowed one", () => {
    const v = checkImageSrc(
      "https://automatic.jaalyantra.com.evil.test/x.png",
      ORIGINS
    )
    expect(v).toEqual({ ok: false, reason: "'src' is not on an allowed image host." })
  })

  it("🔴 refuses the same host over the wrong SCHEME", () => {
    // The allow-list entry is https; http to the same name is a different origin.
    expect(checkImageSrc(`http://automatic.jaalyantra.com/x.png`, ORIGINS).ok).toBe(false)
  })

  it("🔴 refuses the same host on a different PORT", () => {
    expect(checkImageSrc(`http://localhost:9001/static/x.png`, ORIGINS).ok).toBe(false)
  })

  it("🔴 refuses the cloud metadata service and the loopback range", () => {
    expect(checkImageSrc("http://169.254.169.254/latest/meta-data/", ORIGINS).ok).toBe(false)
    expect(checkImageSrc("http://127.0.0.1:5432/", ORIGINS).ok).toBe(false)
    expect(checkImageSrc("http://10.0.0.5/admin", ORIGINS).ok).toBe(false)
  })

  it("🔴 refuses non-http schemes outright", () => {
    for (const src of [
      "file:///etc/passwd",
      "gopher://localhost:11211/_stats",
      "data:image/png;base64,iVBORw0KGgo=",
    ]) {
      expect(checkImageSrc(src, ORIGINS).ok).toBe(false)
    }
  })

  it("refuses a missing or non-string src", () => {
    expect(checkImageSrc(undefined, ORIGINS).ok).toBe(false)
    expect(checkImageSrc("", ORIGINS).ok).toBe(false)
    expect(checkImageSrc("   ", ORIGINS).ok).toBe(false)
    expect(checkImageSrc(42 as any, ORIGINS).ok).toBe(false)
  })

  it("refuses a relative URL — there is nothing to check an origin against", () => {
    expect(checkImageSrc("/static/x.png", ORIGINS).ok).toBe(false)
  })

  it("🔴 with NO configured origins it allows nothing, not everything", () => {
    expect(checkImageSrc(`${CDN}/uploads/flat.png`, []).ok).toBe(false)
  })
})

describe("isInlinableImageType", () => {
  it("accepts image content types, with or without parameters", () => {
    expect(isInlinableImageType("image/png")).toBe(true)
    expect(isInlinableImageType("image/jpeg; charset=binary")).toBe(true)
    expect(isInlinableImageType("IMAGE/WEBP")).toBe(true)
  })

  it("🔴 refuses anything that is not an image — the proxy is not a general fetcher", () => {
    expect(isInlinableImageType("text/html")).toBe(false)
    expect(isInlinableImageType("application/json")).toBe(false)
    expect(isInlinableImageType(null)).toBe(false)
    expect(isInlinableImageType("")).toBe(false)
  })
})
