import { parseMailjetEvents, parseResendEvent, parseKitSuppression } from "../provider-parsers"
import { normalizeEmail, reasonSuppresses, suppressionMetadata } from "../suppress-core"

describe("provider-parsers — parseMailjetEvents", () => {
  it("maps a hard bounce", () => {
    expect(
      parseMailjetEvents({ event: "bounce", email: "A@X.com", hard_bounce: true, MessageID: 42, time: 1_700_000_000 })
    ).toEqual([
      { email: "a@x.com", reason: "hard_bounce", event_id: "mj:bounce:42", event_at: new Date(1_700_000_000_000).toISOString() },
    ])
  })
  it("maps a soft bounce (hard_bounce false)", () => {
    expect(parseMailjetEvents({ event: "bounce", email: "a@x.com", hard_bounce: false })[0].reason).toBe("soft_bounce")
  })
  it("maps blocked→hard, spam→complaint, unsub→unsubscribe", () => {
    expect(parseMailjetEvents({ event: "blocked", email: "a@x.com" })[0].reason).toBe("hard_bounce")
    expect(parseMailjetEvents({ event: "spam", email: "a@x.com" })[0].reason).toBe("spam_complaint")
    expect(parseMailjetEvents({ event: "unsub", email: "a@x.com" })[0].reason).toBe("unsubscribe")
  })
  it("ignores non-suppressing events + accepts arrays", () => {
    const arr = [
      { event: "sent", email: "a@x.com" },
      { event: "open", email: "a@x.com" },
      { event: "bounce", email: "b@y.com", hard_bounce: "true" },
    ]
    const out = parseMailjetEvents(arr)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ email: "b@y.com", reason: "hard_bounce" })
  })
  it("skips events with no email + tolerates junk", () => {
    expect(parseMailjetEvents({ event: "bounce", hard_bounce: true })).toEqual([])
    expect(parseMailjetEvents(null)).toEqual([])
  })
})

describe("provider-parsers — parseResendEvent", () => {
  it("maps email.bounced (default hard) across all recipients", () => {
    const out = parseResendEvent({
      type: "email.bounced",
      created_at: "2026-07-04T00:00:00.000Z",
      data: { email_id: "e1", to: ["A@X.com", "b@y.com"] },
    })
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({
      email: "a@x.com",
      reason: "hard_bounce",
      event_id: "rs:email.bounced:e1:a@x.com",
      event_at: "2026-07-04T00:00:00.000Z",
    })
  })
  it("classifies soft/transient bounce", () => {
    expect(parseResendEvent({ type: "email.bounced", data: { to: "a@x.com", bounce: { type: "Transient" } } })[0].reason).toBe("soft_bounce")
    expect(parseResendEvent({ type: "email.bounced", data: { to: "a@x.com", bounce: { type: "soft" } } })[0].reason).toBe("soft_bounce")
  })
  it("maps email.complained → spam_complaint", () => {
    expect(parseResendEvent({ type: "email.complained", data: { to: ["a@x.com"] } })[0].reason).toBe("spam_complaint")
  })
  it("ignores delivered/other + empty recipients", () => {
    expect(parseResendEvent({ type: "email.delivered", data: { to: ["a@x.com"] } })).toEqual([])
    expect(parseResendEvent({ type: "email.bounced", data: { to: [] } })).toEqual([])
  })
})

describe("suppress-core — normalizeEmail", () => {
  it("lowercases + trims valid; empty for invalid", () => {
    expect(normalizeEmail("  Jane@X.com ")).toBe("jane@x.com")
    expect(normalizeEmail("nope")).toBe("")
    expect(normalizeEmail(null)).toBe("")
  })
})

describe("suppress-core — reasonSuppresses", () => {
  it("suppresses everything except soft bounces", () => {
    expect(reasonSuppresses("hard_bounce")).toBe(true)
    expect(reasonSuppresses("spam_complaint")).toBe(true)
    expect(reasonSuppresses("unsubscribe")).toBe(true)
    expect(reasonSuppresses("manual")).toBe(true)
    expect(reasonSuppresses("soft_bounce")).toBe(false)
  })
})

describe("suppress-core — suppressionMetadata", () => {
  const at = "2026-07-04T00:00:00.000Z"
  it("hard_bounce → bounced, preserving existing", () => {
    expect(suppressionMetadata({ keep: 1 }, "hard_bounce", at)).toEqual({
      keep: 1, bounced: true, bounced_at: at, bounce_reason: "hard_bounce",
    })
  })
  it("spam_complaint → bounced + complained", () => {
    expect(suppressionMetadata(null, "spam_complaint", at)).toEqual({
      bounced: true, bounced_at: at, complained: true, complained_at: at, bounce_reason: "spam_complaint",
    })
  })
  it("unsubscribe → unsubscribed", () => {
    expect(suppressionMetadata(null, "unsubscribe", at)).toEqual({ unsubscribed: true, unsubscribed_at: at })
  })
  it("is idempotent per reason", () => {
    expect(suppressionMetadata({ bounced: true }, "hard_bounce", at)).toBeNull()
    expect(suppressionMetadata({ unsubscribed: true }, "unsubscribe", at)).toBeNull()
    expect(suppressionMetadata({ bounced: true, complained: true }, "spam_complaint", at)).toBeNull()
  })
  it("upgrades a bounced record to also complained", () => {
    expect(suppressionMetadata({ bounced: true, bounced_at: "old" }, "spam_complaint", at)).toEqual({
      bounced: true, bounced_at: "old", complained: true, complained_at: at, bounce_reason: "spam_complaint",
    })
  })
})

describe("provider-parsers — parseKitSuppression", () => {
  it("maps bounce→hard_bounce with a stable per-subscriber+kind id", () => {
    expect(
      parseKitSuppression(
        { subscriber: { id: 77, email_address: "A@X.com" }, created_at: "2026-07-04T00:00:00.000Z" },
        "bounce"
      )
    ).toEqual([
      { email: "a@x.com", reason: "hard_bounce", event_id: "kit:bounce:77", event_at: "2026-07-04T00:00:00.000Z" },
    ])
  })
  it("maps complain→spam_complaint and unsubscribe→unsubscribe", () => {
    expect(parseKitSuppression({ subscriber: { id: 1, email_address: "a@x.com" } }, "complain")[0].reason).toBe("spam_complaint")
    expect(parseKitSuppression({ subscriber: { id: 1, email_address: "a@x.com" } }, "unsubscribe")[0].reason).toBe("unsubscribe")
  })
  it("reads a flat subscriber object and lowercases the email", () => {
    expect(parseKitSuppression({ email_address: "B@Y.com", id: 5 }, "bounce")[0]).toMatchObject({
      email: "b@y.com", reason: "hard_bounce", event_id: "kit:bounce:5",
    })
  })
  it("ignores the click kind (engagement, not suppression) and junk", () => {
    expect(parseKitSuppression({ subscriber: { id: 1, email_address: "a@x.com" } }, "click")).toEqual([])
    expect(parseKitSuppression({ subscriber: { id: 1 } }, "bounce")).toEqual([])
    expect(parseKitSuppression(null, "bounce")).toEqual([])
  })
})
