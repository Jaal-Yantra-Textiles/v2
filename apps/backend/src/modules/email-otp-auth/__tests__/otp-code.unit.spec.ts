import {
  checkOtp,
  generateOtpCode,
  issueOtp,
  normalizeOtpEmail,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MINUTES,
} from "../otp-code"

/**
 * #2543 phase 2 — the pure half of the email sign-in code: generation,
 * hashing, expiry, the attempt cap and single use. No DB, no container.
 */
describe("email-otp codes", () => {
  const NOW = Date.parse("2026-11-17T10:00:00.000Z")

  it("generates 6-digit codes, keeping leading zeros", () => {
    const codes = Array.from({ length: 500 }, generateOtpCode)
    for (const c of codes) expect(c).toMatch(/^\d{6}$/)
    // 500 draws from a million: duplicates are possible but a constant is not.
    expect(new Set(codes).size).toBeGreaterThan(450)
  })

  it("stores only a hash, with a 10-minute expiry and a fresh attempt counter", async () => {
    const pending = await issueOtp("004817", NOW, { attempts: 4, verified_at: "earlier" } as any)
    expect(pending.code_hash).toMatch(/^scrypt\$/)
    expect(pending.code_hash).not.toContain("004817")
    expect(JSON.stringify(pending)).not.toContain("004817")
    expect(pending.attempts).toBe(0)
    expect(pending.created_at).toBe(new Date(NOW).toISOString())
    expect(Date.parse(pending.expires_at!) - NOW).toBe(OTP_TTL_MINUTES * 60_000)
    expect(pending.verified_at).toBe("earlier")
  })

  it("accepts the right code once, then burns it (single use)", async () => {
    const pending = await issueOtp("123456", NOW)
    const first = await checkOtp(pending, "123456", NOW + 1000)
    expect(first.ok).toBe(true)
    expect(first.next.code_hash).toBeNull()
    expect(first.next.verified_at).toBe(new Date(NOW + 1000).toISOString())

    const replay = await checkOtp(first.next, "123456", NOW + 2000)
    expect(replay).toMatchObject({ ok: false, reason: "invalid_code" })
  })

  it("refuses a wrong code and counts the attempt", async () => {
    const pending = await issueOtp("123456", NOW)
    const res = await checkOtp(pending, "654321", NOW + 1000)
    expect(res).toMatchObject({ ok: false, reason: "invalid_code" })
    expect(res.next.attempts).toBe(1)
    expect(res.next.code_hash).toBe(pending.code_hash)
  })

  it("refuses an expired code — even the right one — and burns it", async () => {
    const pending = await issueOtp("123456", NOW)
    const res = await checkOtp(pending, "123456", NOW + OTP_TTL_MINUTES * 60_000 + 1)
    expect(res).toMatchObject({ ok: false, reason: "code_expired" })
    expect(res.next.code_hash).toBeNull()
  })

  it(`🔴 the ${OTP_MAX_ATTEMPTS}th wrong guess burns the code — the right one no longer works`, async () => {
    let meta: any = await issueOtp("123456", NOW)
    const reasons: string[] = []
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      const r = await checkOtp(meta, "000000", NOW + 1000)
      reasons.push((r as any).reason)
      meta = r.next
    }
    expect(reasons.slice(0, OTP_MAX_ATTEMPTS - 1).every((r) => r === "invalid_code")).toBe(true)
    expect(reasons[OTP_MAX_ATTEMPTS - 1]).toBe("too_many_attempts")
    expect(meta.code_hash).toBeNull()

    const right = await checkOtp(meta, "123456", NOW + 2000)
    expect(right.ok).toBe(false)
  })

  it("rejects non-6-digit input without consuming the hash check", async () => {
    const pending = await issueOtp("123456", NOW)
    const res = await checkOtp(pending, "12345a", NOW + 1000)
    expect(res).toMatchObject({ ok: false, reason: "invalid_code" })
  })

  it("normalises emails and refuses junk", () => {
    expect(normalizeOtpEmail("  Maker@Example.COM ")).toBe("maker@example.com")
    expect(normalizeOtpEmail("not-an-email")).toBeNull()
    expect(normalizeOtpEmail(42)).toBeNull()
  })
})
