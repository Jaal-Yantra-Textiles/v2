import { describe, it, expect } from "vitest"
import { createHmac } from "node:crypto"
import { normalizeTrackEvent, chunk, hmacHex } from "../src/lib"

describe("normalizeTrackEvent", () => {
  const ctx = { country: "IN", now: "2026-06-19T10:00:00.000Z", id: "gen-uuid" }

  it("maps a full client payload + enriches event_id/country/timestamp", () => {
    const e = normalizeTrackEvent(
      {
        website_id: "web_1",
        pathname: "/p/shoes",
        visitor_id: "vis_1",
        session_id: "ses_1",
        referrer: "https://google.com",
        utm_source: "google",
      },
      ctx
    )
    expect(e).toMatchObject({
      website_id: "web_1",
      pathname: "/p/shoes",
      visitor_id: "vis_1",
      session_id: "ses_1",
      referrer: "https://google.com",
      utm_source: "google",
      event_id: "gen-uuid", // edge-generated when client omits it
      country: "IN", // from request.cf
      timestamp: "2026-06-19T10:00:00.000Z",
    })
  })

  it("prefers a client-supplied event_id/country/timestamp over the edge defaults", () => {
    const e = normalizeTrackEvent(
      {
        website_id: "web_1",
        pathname: "/",
        visitor_id: "v",
        session_id: "s",
        event_id: "client-id",
        country: "US",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
      ctx
    )
    expect(e?.event_id).toBe("client-id")
    expect(e?.country).toBe("US")
    expect(e?.timestamp).toBe("2026-01-01T00:00:00.000Z")
  })

  it("drops events missing any of the 4 identity fields", () => {
    expect(normalizeTrackEvent({ website_id: "w", pathname: "/", visitor_id: "v" }, ctx)).toBeNull()
    expect(normalizeTrackEvent({}, ctx)).toBeNull()
  })
})

describe("chunk", () => {
  it("splits to the cap and keeps order", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 500)).toEqual([])
  })
})

describe("hmacHex", () => {
  it("matches Node's HMAC-SHA256 over the exact body string (server parity)", async () => {
    const secret = "s3cr3t"
    const body = JSON.stringify({ events: [{ a: 1 }] })
    const fromWorker = await hmacHex(secret, body)
    const fromNode = createHmac("sha256", secret).update(body).digest("hex")
    // This is precisely what the Medusa endpoint computes over its raw body.
    expect(fromWorker).toBe(fromNode)
  })
})
