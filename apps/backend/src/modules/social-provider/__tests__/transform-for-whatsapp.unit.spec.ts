import {
  transformForWhatsApp,
  WHATSAPP_MAX_IMAGE_BYTES,
} from "../image-transformer"

/**
 * #1279 — 132 partner reminders between 2026-04 and 2026-08 were rejected by
 * Meta with `131053 · Image file has size 6533833 bytes but must be atmost
 * 5242880 bytes`. Meta drops the WHOLE message, so the partner saw nothing,
 * stayed silent, hit the reminder cap, and the run was parked unasked.
 *
 * Measured against the real asset host: 1,665,812 B PNG → 180,996 B JPEG.
 */

const CF = "https://automatic.jaalyantra.com/automatica/design-01KTDQ.png"

describe("transformForWhatsApp", () => {
  it("states Meta's ceiling as the real one", () => {
    expect(WHATSAPP_MAX_IMAGE_BYTES).toBe(5242880)
  })

  it("rewrites a Cloudflare-backed asset through the resizing path", () => {
    const out = transformForWhatsApp(CF)
    expect(out).toContain("/cdn-cgi/image/")
    expect(out).toContain("/automatica/design-01KTDQ.png")
  })

  it("forces jpeg rather than auto — Meta's fetcher does not take webp/avif", () => {
    const out = transformForWhatsApp(CF)
    expect(out).toContain("format=jpeg")
    expect(out).not.toContain("format=auto")
  })

  it("scales down only, and never crops a design photo to a square", () => {
    const out = transformForWhatsApp(CF)
    expect(out).toContain("fit=scale-down")
    expect(out).toContain("width=1600")
    expect(out).not.toContain("height=")
  })

  it("leaves a non-Cloudflare URL untouched — silently sending a different image is worse", () => {
    const foreign = "https://example.com/some/photo.png"
    expect(transformForWhatsApp(foreign)).toBe(foreign)
  })

  it("does not rewrite a rewrite — nesting the path yields a 404", () => {
    const once = transformForWhatsApp(CF)
    expect(transformForWhatsApp(once)).toBe(once)
  })

  it("passes empty input straight through", () => {
    expect(transformForWhatsApp("")).toBe("")
  })
})
