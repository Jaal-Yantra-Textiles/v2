import {
  isPanelPublic,
  applyPublicAuditStamp,
} from "../public-utils"

describe("stats/public-utils — isPanelPublic", () => {
  it("returns true only for metadata.public === true", () => {
    expect(isPanelPublic({ metadata: { public: true } })).toBe(true)
  })

  it("is private by default (no metadata)", () => {
    expect(isPanelPublic({})).toBe(false)
    expect(isPanelPublic({ metadata: undefined })).toBe(false)
  })

  it("treats truthy-but-not-true values as private (strict opt-in)", () => {
    expect(isPanelPublic({ metadata: { public: "true" } })).toBe(false)
    expect(isPanelPublic({ metadata: { public: 1 } })).toBe(false)
    expect(isPanelPublic({ metadata: { public: false } })).toBe(false)
  })
})

describe("stats/public-utils — applyPublicAuditStamp", () => {
  const NOW = "2026-06-18T00:00:00.000Z"

  it("returns incoming unchanged when no metadata is in the payload", () => {
    expect(applyPublicAuditStamp({ public: true }, undefined, "usr_1", NOW)).toBeUndefined()
  })

  it("stamps actor + timestamp when toggled private -> public", () => {
    const out = applyPublicAuditStamp(undefined, { public: true }, "usr_admin", NOW)
    expect(out).toEqual({
      public: true,
      public_set_by: "usr_admin",
      public_set_at: NOW,
    })
  })

  it("stamps when toggled public -> private (records the un-share)", () => {
    const out = applyPublicAuditStamp({ public: true }, { public: false }, "usr_admin", NOW)
    expect(out).toEqual({
      public: false,
      public_set_by: "usr_admin",
      public_set_at: NOW,
    })
  })

  it("does NOT re-stamp when public is unchanged and there are no prior stamps", () => {
    const incoming = { public: true, note: "edited" }
    const out = applyPublicAuditStamp({ public: true }, incoming, "usr_admin", NOW)
    expect(out).toBe(incoming) // same ref — no churn
    expect((out as any).public_set_by).toBeUndefined()
  })

  it("carries forward prior stamps on an unrelated edit while staying public", () => {
    const current = { public: true, public_set_by: "usr_first", public_set_at: "2026-01-01T00:00:00.000Z" }
    const incoming = { public: true, note: "edited" } // client dropped the stamps
    const out = applyPublicAuditStamp(current, incoming, "usr_admin", NOW)
    expect(out).toEqual({
      public: true,
      note: "edited",
      public_set_by: "usr_first",
      public_set_at: "2026-01-01T00:00:00.000Z",
    })
  })

  it("does not override stamps the client legitimately echoed back", () => {
    const current = { public: true, public_set_by: "usr_first", public_set_at: "2026-01-01T00:00:00.000Z" }
    const incoming = { public: true, public_set_by: "usr_first", public_set_at: "2026-01-01T00:00:00.000Z" }
    const out = applyPublicAuditStamp(current, incoming, "usr_admin", NOW)
    expect(out).toBe(incoming) // nothing to carry forward → same ref
  })

  it("does NOT stamp on an unrelated metadata edit (both private)", () => {
    const incoming = { note: "edited" }
    const out = applyPublicAuditStamp({ note: "old" }, incoming, "usr_admin", NOW)
    expect(out).toBe(incoming)
  })

  it("overwrites client-supplied audit keys on a real toggle (server is source of truth)", () => {
    const out = applyPublicAuditStamp(
      undefined,
      { public: true, public_set_by: "spoofed", public_set_at: "spoofed" },
      "usr_admin",
      NOW
    )
    expect(out).toEqual({
      public: true,
      public_set_by: "usr_admin",
      public_set_at: NOW,
    })
  })

  it("falls back to null actor when unauthenticated id is absent", () => {
    const out = applyPublicAuditStamp(undefined, { public: true }, undefined, NOW)
    expect((out as any).public_set_by).toBeNull()
  })
})
