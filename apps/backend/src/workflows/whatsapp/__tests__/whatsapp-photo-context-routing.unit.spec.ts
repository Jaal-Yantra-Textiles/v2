import {
  resolveLivePhotoContextAction,
  resolvePhotoPurpose,
} from "../whatsapp-photo-context-routing"

/**
 * What a LIVE photo context causes (#2138).
 *
 * The defect these pin down: #2143 stamps a context and nothing read it. The
 * handler used it only to skip batching, so an admin who said "these will be
 * fabric they're selling us" got a photo filed to a catchall and a partner who
 * was told nothing. And `photo_purpose` — which the product-create flow's
 * eligibility rule tests — was set nowhere at all.
 */
describe("resolveLivePhotoContextAction", () => {
  const NOW = new Date("2026-09-18T12:00:00.000Z")
  const live = (kind: string) => ({
    kind,
    set_at: "2026-09-18T09:00:00.000Z",
    expires_at: "2026-09-21T09:00:00.000Z",
  })
  const expired = (kind: string) => ({
    kind,
    set_at: "2026-09-01T09:00:00.000Z",
    expires_at: "2026-09-04T09:00:00.000Z",
  })

  it("🔴 inventory_offer files a textile analysis and answers the partner", () => {
    const a = resolveLivePhotoContextAction(live("inventory_offer") as any, NOW)
    expect(a).toMatchObject({
      kind: "inventory_offer",
      photo_purpose: "inventory_offer",
      analyse: true,
      reply: "here",
    })
    expect(a?.confirmation).toBeTruthy()
  })

  it("🔴 product_submission leaves the reply to the FLOW — two replies for one photo is the bug", () => {
    const a = resolveLivePhotoContextAction(live("product_submission") as any, NOW)
    expect(a?.reply).toBe("flow")
    expect(a?.confirmation).toBeNull()
    // The flow mints the product; analysing here as well would be a second,
    // unasked-for opinion on the same image.
    expect(a?.analyse).toBe(false)
  })

  it("run_progress confirms without analysing — nobody asked what the cloth is", () => {
    const a = resolveLivePhotoContextAction(live("run_progress") as any, NOW)
    expect(a).toMatchObject({ analyse: false, reply: "here" })
    expect(a?.confirmation).toBeTruthy()
  })

  it("🔴 an EXPIRED context decides nothing — a stale intent must not reinterpret today's photo", () => {
    expect(resolveLivePhotoContextAction(expired("inventory_offer") as any, NOW)).toBeNull()
  })

  it("🔴 an UNRECOGNISED kind falls back to asking, never to silence", () => {
    // A context written before a rename, or a hand-edited blob. The photo must
    // rejoin the batch-and-ask path rather than vanish into a catchall.
    expect(resolveLivePhotoContextAction(live("document") as any, NOW)).toBeNull()
    expect(resolveLivePhotoContextAction(live("bank_slip") as any, NOW)).toBeNull()
  })

  it("no context at all is not an action", () => {
    expect(resolveLivePhotoContextAction(null, NOW)).toBeNull()
    expect(resolveLivePhotoContextAction(undefined, NOW)).toBeNull()
    expect(resolveLivePhotoContextAction({ kind: "" } as any, NOW)).toBeNull()
  })

  it("🔴 a context with NO expiry reads as expired, not as forever", () => {
    expect(
      resolveLivePhotoContextAction({ kind: "inventory_offer", set_at: "x" } as any, NOW)
    ).toBeNull()
  })

  it("every recognised kind says who replies and never leaves the partner with nothing", () => {
    for (const kind of ["inventory_offer", "product_submission", "run_progress"]) {
      const a = resolveLivePhotoContextAction(live(kind) as any, NOW)
      expect(a).not.toBeNull()
      // Either we answer, or the flow does. "Neither" is the silence this
      // whole slice exists to remove.
      expect(a!.reply === "flow" || Boolean(a!.confirmation)).toBe(true)
    }
  })
})

describe("resolvePhotoPurpose", () => {
  const NOW = new Date("2026-09-18T12:00:00.000Z")

  it("🔴 stamps the purpose the product-create flow's eligibility rule tests", () => {
    // `$trigger.photo_purpose === 'product_submission'` could never be true
    // before this: the webhook emitted no such key.
    expect(
      resolvePhotoPurpose(
        { kind: "product_submission", set_at: "2026-09-18T09:00:00.000Z", expires_at: "2026-09-21T09:00:00.000Z" } as any,
        NOW
      )
    ).toBe("product_submission")
  })

  it("stamps nothing when no context is live, so the flow stays shut", () => {
    expect(resolvePhotoPurpose(null, NOW)).toBeNull()
    expect(
      resolvePhotoPurpose(
        { kind: "product_submission", set_at: "x", expires_at: "2026-09-01T00:00:00.000Z" } as any,
        NOW
      )
    ).toBeNull()
  })
})
