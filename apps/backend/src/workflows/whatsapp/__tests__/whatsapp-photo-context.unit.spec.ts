import {
  PHOTO_CONTEXT_KINDS,
  PHOTO_CONTEXT_DEFAULT_TTL_HOURS,
  PHOTO_CONTEXT_MAX_TTL_HOURS,
  UNSUPPORTED_KINDS,
  buildPhotoRequestPurpose,
  resolveContextExpiry,
} from "../whatsapp-photo-context"
import { isPhotoContextLive } from "../whatsapp-photo-batch"

const BASE = "2026-09-18T10:00:00.000Z"
const at = (h: number) => new Date(Date.parse(BASE) + h * 3_600_000)

describe("photo context kinds", () => {
  it("only lists kinds that have somewhere real to land", () => {
    expect(Object.keys(PHOTO_CONTEXT_KINDS).sort()).toEqual([
      "inventory_offer",
      "product_submission",
      "run_progress",
    ])
  })

  it("🔴 refuses `document`, with the reason, rather than filing it nowhere", () => {
    // Accepting it would put the file in a catchall and report success — the
    // admin would believe it was captured against the order.
    expect(UNSUPPORTED_KINDS.document).toContain("no typed destination")
    expect(PHOTO_CONTEXT_KINDS).not.toHaveProperty("document")
  })

  it("uses the exact string the product-create flow gates on", () => {
    // sync-partner-product-create-flow requires photo_purpose ===
    // 'product_submission'; a typo here routes photos nowhere, silently.
    expect(PHOTO_CONTEXT_KINDS).toHaveProperty("product_submission")
  })
})

describe("resolveContextExpiry", () => {
  it("defaults to 72 hours from the ask", () => {
    expect(resolveContextExpiry(at(0))).toBe(at(PHOTO_CONTEXT_DEFAULT_TTL_HOURS).toISOString())
  })

  it("honours a shorter explicit ttl", () => {
    expect(resolveContextExpiry(at(0), 6)).toBe(at(6).toISOString())
  })

  it("caps a long ttl at the ceiling", () => {
    expect(resolveContextExpiry(at(0), 24 * 365)).toBe(
      at(PHOTO_CONTEXT_MAX_TTL_HOURS).toISOString()
    )
  })

  it("🔴 a refresh cannot push the context past the ceiling from the ORIGINAL ask", () => {
    // The expiry is refreshed as photos arrive, so without this a steady
    // trickle would make a context permanent — stale state deciding a live
    // action, which is #2122's defect again.
    const setAt = at(0)
    const refreshedLate = resolveContextExpiry(at(160), 72, setAt)
    expect(refreshedLate).toBe(at(PHOTO_CONTEXT_MAX_TTL_HOURS).toISOString())
  })

  it("falls back to the default for nonsense ttls", () => {
    for (const bad of [0, -5, NaN, Infinity] as number[]) {
      expect(resolveContextExpiry(at(0), bad)).toBe(
        at(PHOTO_CONTEXT_DEFAULT_TTL_HOURS).toISOString()
      )
    }
  })

  it("produces something isPhotoContextLive agrees with", () => {
    // The two halves must not disagree about what "live" means.
    const ctx = {
      kind: "inventory_offer",
      set_at: at(0).toISOString(),
      expires_at: resolveContextExpiry(at(0), 24),
    }
    expect(isPhotoContextLive(ctx, at(1))).toBe(true)
    expect(isPhotoContextLive(ctx, at(25))).toBe(false)
  })
})

describe("buildPhotoRequestPurpose", () => {
  it("describes the purpose in words a person would use", () => {
    const p = buildPhotoRequestPurpose("inventory_offer")
    expect(p).toContain("buying stock or material from them")
    expect(p).not.toContain("inventory_offer")
  })

  it("lets the admin's own note win, because they know why they are asking", () => {
    const p = buildPhotoRequestPurpose(
      "inventory_offer",
      "the leftover pashmina we discussed yesterday"
    )
    expect(p).toContain("leftover pashmina we discussed yesterday")
  })

  it("forbids promising a price, quantity or date", () => {
    expect(buildPhotoRequestPurpose("product_submission")).toContain(
      "do not promise a price, a quantity or a date"
    )
  })

  it("ignores a blank note instead of emitting an empty clause", () => {
    const p = buildPhotoRequestPurpose("run_progress", "   ")
    expect(p).not.toContain("in our own words:")
  })
})
