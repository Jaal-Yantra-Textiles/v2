import {
  buildPartnerVerificationEmail,
  resolveVerifyUrlPrefix,
} from "../build-partner-verification-email"

describe("resolveVerifyUrlPrefix", () => {
  it("defaults to the partner portal", () => {
    expect(resolveVerifyUrlPrefix("partner")).toBe(
      "https://partner.jaalyantra.com"
    )
  })

  it("routes customer to the storefront origin", () => {
    expect(resolveVerifyUrlPrefix("customer")).toBe("https://cicilabel.com")
  })

  it("routes admin/user to the admin app", () => {
    expect(resolveVerifyUrlPrefix("admin")).toBe("https://v3.jaalyantra.com/app")
    expect(resolveVerifyUrlPrefix("user")).toBe("https://v3.jaalyantra.com/app")
  })

  it("falls back to the partner portal for unknown actors", () => {
    expect(resolveVerifyUrlPrefix("something-else")).toBe(
      "https://partner.jaalyantra.com"
    )
  })

  it("honours an explicit override prefix and trims trailing slashes", () => {
    expect(
      resolveVerifyUrlPrefix("partner", "http://localhost:5173/")
    ).toBe("http://localhost:5173")
  })
})

describe("buildPartnerVerificationEmail", () => {
  const base = {
    entity_id: "artisan@example.com",
    entity_type: "email",
    code: "raw-token-123",
    code_provider: "token",
    auth_identity_id: "authid_1",
  }

  it("builds the partner verify deep link with code + email query params", () => {
    const out = buildPartnerVerificationEmail(base)

    expect(out.to).toBe("artisan@example.com")
    expect(out.actorType).toBe("partner")

    const url = new URL(out.verifyUrl)
    expect(url.origin).toBe("https://partner.jaalyantra.com")
    expect(url.pathname).toBe("/verify-email")
    expect(url.searchParams.get("code")).toBe("raw-token-123")
    expect(url.searchParams.get("email")).toBe("artisan@example.com")
  })

  it("url-encodes emails with special characters", () => {
    const out = buildPartnerVerificationEmail({
      ...base,
      entity_id: "a+b@example.com",
    })
    const url = new URL(out.verifyUrl)
    // Round-trips back to the original address.
    expect(url.searchParams.get("email")).toBe("a+b@example.com")
    expect(url.searchParams.get("code")).toBe("raw-token-123")
  })

  it("computes whole-minute expiry from expires_at against an injected clock", () => {
    const now = 1_000_000
    const out = buildPartnerVerificationEmail(
      { ...base, expires_at: new Date(now + 15 * 60_000).toISOString() },
      now
    )
    expect(out.expiresMinutes).toBe(15)
  })

  it("returns 0 minutes when already expired and null when absent", () => {
    const now = 1_000_000
    expect(
      buildPartnerVerificationEmail(
        { ...base, expires_at: new Date(now - 5_000).toISOString() },
        now
      ).expiresMinutes
    ).toBe(0)
    expect(buildPartnerVerificationEmail(base, now).expiresMinutes).toBeNull()
  })

  it("respects an actor_type + url_prefix override supplied via metadata", () => {
    const out = buildPartnerVerificationEmail({
      ...base,
      metadata: { actor_type: "partner", url_prefix: "http://localhost:5173" },
    })
    expect(out.verifyUrl.startsWith("http://localhost:5173/verify-email")).toBe(
      true
    )
  })

  it("throws when the email or code is missing", () => {
    expect(() =>
      buildPartnerVerificationEmail({ ...base, entity_id: "" })
    ).toThrow(/entity_id/)
    expect(() =>
      buildPartnerVerificationEmail({ ...base, code: undefined })
    ).toThrow(/code/)
  })
})
