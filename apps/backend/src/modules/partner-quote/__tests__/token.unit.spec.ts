import {
  DEFAULT_QUOTE_TTL_DAYS,
  daysUntilExpiry,
  effectiveQuoteStatus,
  generateQuoteToken,
  hashQuoteToken,
  isQuoteUsable,
  quoteExpiryFrom,
  quoteUnusableReason,
  withEffectiveStatus,
} from "../lib/token"

const NOW = new Date("2026-08-21T12:00:00.000Z")
const days = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000)

describe("partner-quote token", () => {
  it("mints a high-entropy raw token and persists only its hash", () => {
    const { raw, hash } = generateQuoteToken()

    // 32 random bytes, base64url — no padding, URL-safe, since this ships in a
    // link that gets forwarded by email.
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(raw.length).toBeGreaterThanOrEqual(43)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(hash).not.toContain(raw)
    expect(hashQuoteToken(raw)).toBe(hash)
  })

  it("does not repeat itself", () => {
    const seen = new Set(
      Array.from({ length: 50 }, () => generateQuoteToken().raw)
    )
    expect(seen.size).toBe(50)
  })

  it("defaults to a 14-day link", () => {
    expect(DEFAULT_QUOTE_TTL_DAYS).toBe(14)
    expect(quoteExpiryFrom(NOW).toISOString()).toBe(
      days(14).toISOString()
    )
    expect(quoteExpiryFrom(NOW, 30).toISOString()).toBe(days(30).toISOString())
  })

  describe("usability is derived at read time, never swept by a cron", () => {
    it("is usable while active and unexpired", () => {
      const q = { status: "active", expires_at: days(3) }
      expect(quoteUnusableReason(q, NOW)).toBeNull()
      expect(isQuoteUsable(q, NOW)).toBe(true)
    })

    it("is usable forever when no expiry is set", () => {
      expect(isQuoteUsable({ status: "active", expires_at: null }, NOW)).toBe(
        true
      )
    })

    it("reports expired once the moment passes", () => {
      expect(
        quoteUnusableReason({ status: "active", expires_at: days(-1) }, NOW)
      ).toBe("expired")
    })

    it("treats the exact expiry instant as expired, not as the last usable moment", () => {
      expect(
        quoteUnusableReason({ status: "active", expires_at: NOW }, NOW)
      ).toBe("expired")
    })

    it("reports superseded ahead of expired — the buyer has somewhere to go", () => {
      // #1435: a superseded quote is usually still inside its own TTL, but even
      // once past it, "a newer quote replaced this" is the more useful thing to
      // say than "this expired" — one of them points the buyer somewhere.
      expect(
        quoteUnusableReason({ status: "superseded", expires_at: days(-1) }, NOW)
      ).toBe("superseded")
      expect(
        quoteUnusableReason({ status: "superseded", expires_at: days(7) }, NOW)
      ).toBe("superseded")
    })

    it("reports revoked ahead of superseded — a withdrawal is the stronger fact", () => {
      expect(
        quoteUnusableReason({ status: "revoked", expires_at: days(7) }, NOW)
      ).toBe("revoked")
    })

    it("reports revoked ahead of expired — a withdrawn quote is not merely stale", () => {
      // The two states get different copy: "expired" invites a re-send,
      // "revoked" does not. Ordering them wrong would tell a buyer to ask for
      // a refresh of something the partner deliberately pulled.
      expect(
        quoteUnusableReason({ status: "revoked", expires_at: days(-1) }, NOW)
      ).toBe("revoked")
    })

    it("accepts an ISO string as readily as a Date (that is what a DB read gives back)", () => {
      expect(
        quoteUnusableReason(
          { status: "active", expires_at: days(-1).toISOString() },
          NOW
        )
      ).toBe("expired")
    })
  })

  describe("daysUntilExpiry drives the amber nudge", () => {
    it("rounds up, so 'expires in 1 day' never shows as 0 while it is still live", () => {
      expect(
        daysUntilExpiry(
          { status: "active", expires_at: new Date(NOW.getTime() + 3600_000) },
          NOW
        )
      ).toBe(1)
    })

    it("floors at zero rather than going negative", () => {
      expect(
        daysUntilExpiry({ status: "active", expires_at: days(-5) }, NOW)
      ).toBe(0)
    })

    it("is null when the link never expires", () => {
      expect(
        daysUntilExpiry({ status: "active", expires_at: null }, NOW)
      ).toBeNull()
    })
  })
})

/**
 * #1510 — the word an operator reads to answer "is this offer still standing".
 */
describe("effectiveQuoteStatus", () => {
  it("is `active` while the quote is inside its own TTL", () => {
    expect(
      effectiveQuoteStatus({ status: "active", expires_at: days(7) }, NOW)
    ).toBe("active")
  })

  it("🔴 is `expired` once the date has passed, though the column says active", () => {
    // The whole defect: the stored enum has no `expired`, so this row read
    // `active` on every list while the buyer page refused to price its link.
    expect(
      effectiveQuoteStatus({ status: "active", expires_at: days(-1) }, NOW)
    ).toBe("expired")
  })

  it("keeps `revoked` and `superseded` ahead of expiry", () => {
    // A superseded quote is usually still inside its TTL, and "a newer quote
    // replaced this" is the more useful thing to say. Precedence is decided
    // once, in `quoteUnusableReason` — this only proves it is not re-decided.
    expect(
      effectiveQuoteStatus({ status: "superseded", expires_at: days(-1) }, NOW)
    ).toBe("superseded")
    expect(
      effectiveQuoteStatus({ status: "revoked", expires_at: days(-1) }, NOW)
    ).toBe("revoked")
  })

  it("never expires a quote with no expiry", () => {
    expect(
      effectiveQuoteStatus({ status: "active", expires_at: null }, NOW)
    ).toBe("active")
  })

  it("agrees with the buyer page, by construction", () => {
    // Not a tautology worth skipping: the list and the buyer page forming two
    // opinions is the failure the issue asks to avoid, and this is the
    // assertion that breaks if someone re-derives expiry here later.
    for (const q of [
      { status: "active", expires_at: days(-1) },
      { status: "active", expires_at: days(1) },
      { status: "revoked", expires_at: days(1) },
      { status: "superseded", expires_at: days(-1) },
    ]) {
      expect(effectiveQuoteStatus(q, NOW)).toBe(
        quoteUnusableReason(q, NOW) ?? "active"
      )
    }
  })

  it("survives a `now` that has been through JSON", () => {
    // Same trap `quoteUnusableReason` documents: a Date crossing a workflow
    // step boundary arrives as an ISO string.
    expect(
      effectiveQuoteStatus(
        { status: "active", expires_at: days(-1) },
        NOW.toISOString()
      )
    ).toBe("expired")
  })
})

describe("withEffectiveStatus", () => {
  it("adds the computed word WITHOUT replacing the stored one", () => {
    // Both travel: a superseded quote and an expired one are different
    // conversations, and overwriting `status` would make the API disagree with
    // the column it is named after.
    const stamped = withEffectiveStatus(
      { id: "pq_1", status: "active", expires_at: days(-1) },
      NOW
    )
    expect(stamped.status).toBe("active")
    expect(stamped.status_effective).toBe("expired")
    expect(stamped.id).toBe("pq_1")
  })
})
