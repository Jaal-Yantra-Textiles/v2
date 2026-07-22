import {
  parseMailjetEngagement,
  parseResendEngagement,
  parseKitEngagement,
} from "../provider-parsers"
import { applyEngagement } from "../engagement-core"

describe("provider-parsers — parseMailjetEngagement", () => {
  it("maps sent→delivered / open / click with per-message+type event ids", () => {
    expect(
      parseMailjetEngagement({ event: "sent", email: "A@X.com", MessageID: 42, time: 1_700_000_000 })
    ).toEqual([
      {
        email: "a@x.com",
        type: "delivered",
        event_id: "mje:delivered:42",
        event_at: new Date(1_700_000_000_000).toISOString(),
        message_id: "42",
      },
    ])
    expect(parseMailjetEngagement({ event: "open", email: "a@x.com", MessageID: 42 })[0]).toMatchObject({ type: "open", event_id: "mje:open:42" })
    expect(parseMailjetEngagement({ event: "click", email: "a@x.com", MessageID: 42 })[0]).toMatchObject({ type: "click", event_id: "mje:click:42" })
  })
  it("ignores suppression + unknown events, accepts arrays", () => {
    const out = parseMailjetEngagement([
      { event: "bounce", email: "a@x.com" },
      { event: "spam", email: "a@x.com" },
      { event: "open", email: "b@y.com", MessageID: 7 },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ email: "b@y.com", type: "open" })
  })
  it("skips no-email + tolerates junk; null event_id when no message id", () => {
    expect(parseMailjetEngagement({ event: "open" })).toEqual([])
    expect(parseMailjetEngagement(null)).toEqual([])
    expect(parseMailjetEngagement({ event: "open", email: "a@x.com" })[0].event_id).toBeNull()
  })
})

describe("provider-parsers — parseResendEngagement", () => {
  it("maps delivered/opened/clicked across all recipients", () => {
    const out = parseResendEngagement({
      type: "email.delivered",
      created_at: "2026-07-06T00:00:00.000Z",
      data: { email_id: "e1", to: ["A@X.com", "b@y.com"] },
    })
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({
      email: "a@x.com",
      type: "delivered",
      event_id: "rse:delivered:e1:a@x.com",
      event_at: "2026-07-06T00:00:00.000Z",
      message_id: "e1",
    })
    expect(parseResendEngagement({ type: "email.opened", data: { email_id: "e1", to: "a@x.com" } })[0].type).toBe("open")
    expect(parseResendEngagement({ type: "email.clicked", data: { email_id: "e1", to: "a@x.com" } })[0].type).toBe("click")
  })
  it("does NOT count email.sent (pre-delivery) and ignores bounces + empty recipients", () => {
    expect(parseResendEngagement({ type: "email.sent", data: { to: ["a@x.com"] } })).toEqual([])
    expect(parseResendEngagement({ type: "email.bounced", data: { to: ["a@x.com"] } })).toEqual([])
    expect(parseResendEngagement({ type: "email.opened", data: { to: [] } })).toEqual([])
  })
})

describe("engagement-core — applyEngagement", () => {
  const t0 = "2026-06-01T00:00:00.000Z"
  const t1 = "2026-06-08T00:00:00.000Z"
  const t2 = "2026-06-15T00:00:00.000Z"

  it("folds a first delivery into an empty aggregate", () => {
    expect(applyEngagement(null, "delivered", t0)).toEqual({
      delivered_count: 1,
      opens_count: 0,
      clicks_count: 0,
      delivered_since_last_open: 1,
      first_delivered_at: t0,
      last_delivered_at: t0,
      last_open_at: null,
      last_click_at: null,
      last_event_at: t0,
    })
  })

  it("builds a cold streak across deliveries, then an open resets it", () => {
    let agg = applyEngagement(null, "delivered", t0)
    agg = applyEngagement(agg, "delivered", t1)
    expect(agg.delivered_since_last_open).toBe(2)
    agg = applyEngagement(agg, "open", t2)
    expect(agg).toMatchObject({
      delivered_count: 2,
      opens_count: 1,
      delivered_since_last_open: 0,
      first_delivered_at: t0,
      last_delivered_at: t1,
      last_open_at: t2,
    })
  })

  it("treats a click as engagement: resets streak and implies an open", () => {
    let agg = applyEngagement(null, "delivered", t0)
    agg = applyEngagement(agg, "click", t1)
    expect(agg).toMatchObject({
      clicks_count: 1,
      delivered_since_last_open: 0,
      last_click_at: t1,
      last_open_at: t1,
    })
  })

  it("folds timestamps order-independently (out-of-order webhooks safe)", () => {
    // Later delivery folded first, earlier delivery second.
    let agg = applyEngagement(null, "delivered", t2)
    agg = applyEngagement(agg, "delivered", t0)
    expect(agg.first_delivered_at).toBe(t0)
    expect(agg.last_delivered_at).toBe(t2)
  })
})

describe("provider-parsers — parseKitEngagement", () => {
  it("maps a link_click to a click event keyed by subscriber+link", () => {
    expect(
      parseKitEngagement({
        subscriber: { id: 9, email_address: "A@X.com" },
        link: { url: "https://jaalyantra.com/blog/x" },
        broadcast_id: 55,
        created_at: "2026-07-04T00:00:00.000Z",
      })
    ).toEqual([
      {
        email: "a@x.com",
        type: "click",
        event_id: "kite:click:9:https://jaalyantra.com/blog/x",
        event_at: "2026-07-04T00:00:00.000Z",
        message_id: "55",
      },
    ])
  })
  it("tolerates a flat subscriber + missing link/broadcast", () => {
    const out = parseKitEngagement({ email_address: "b@y.com", id: 3 })
    expect(out[0]).toMatchObject({ email: "b@y.com", type: "click", message_id: null })
  })
  it("skips payloads with no email", () => {
    expect(parseKitEngagement({ subscriber: { id: 1 } })).toEqual([])
    expect(parseKitEngagement(null)).toEqual([])
  })
})
