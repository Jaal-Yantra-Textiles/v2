import crypto from "crypto"
import { verifyEtsyWebhook } from "../lib/webhook"

// Build a valid Svix-style signature the way Etsy/Svix does.
const sign = (secret: string, id: string, ts: number, body: string) => {
  const raw = secret.startsWith("whsec_") ? secret.slice(6) : secret
  const key = Buffer.from(raw, "base64")
  const sig = crypto
    .createHmac("sha256", key)
    .update(`${id}.${ts}.${body}`)
    .digest("base64")
  return `v1,${sig}`
}

describe("verifyEtsyWebhook", () => {
  const secret = "whsec_" + Buffer.from("supersecretkey").toString("base64")
  const id = "msg_123"
  const body = JSON.stringify({ event_type: "order.paid", shop_id: 42 })

  it("accepts a correctly signed, in-window delivery", () => {
    const ts = Math.floor(Date.now() / 1000)
    const res = verifyEtsyWebhook({
      secret,
      headers: { id, timestamp: String(ts), signature: sign(secret, id, ts, body) },
      rawBody: body,
    })
    expect(res.valid).toBe(true)
  })

  it("rejects a tampered body", () => {
    const ts = Math.floor(Date.now() / 1000)
    const res = verifyEtsyWebhook({
      secret,
      headers: { id, timestamp: String(ts), signature: sign(secret, id, ts, body) },
      rawBody: body + "x",
    })
    expect(res.valid).toBe(false)
    expect(res.reason).toMatch(/mismatch/)
  })

  it("rejects an out-of-tolerance timestamp (replay guard)", () => {
    const ts = Math.floor(Date.now() / 1000) - 60 * 60
    const res = verifyEtsyWebhook({
      secret,
      headers: { id, timestamp: String(ts), signature: sign(secret, id, ts, body) },
      rawBody: body,
    })
    expect(res.valid).toBe(false)
    expect(res.reason).toMatch(/tolerance/)
  })

  it("rejects when headers are missing", () => {
    const res = verifyEtsyWebhook({ secret, headers: {}, rawBody: body })
    expect(res.valid).toBe(false)
  })

  it("matches when the header carries multiple space-separated signatures", () => {
    const ts = Math.floor(Date.now() / 1000)
    const good = sign(secret, id, ts, body)
    const res = verifyEtsyWebhook({
      secret,
      headers: { id, timestamp: String(ts), signature: `v1,bogus ${good}` },
      rawBody: body,
    })
    expect(res.valid).toBe(true)
  })
})
