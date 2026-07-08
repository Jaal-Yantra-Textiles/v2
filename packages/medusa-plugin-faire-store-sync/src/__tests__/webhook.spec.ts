import { verifyFaireWebhook } from "../lib/webhook"
import crypto from "crypto"

const secret = "faire-webhook-secret"

const sign = (body: string, enc: "hex" | "base64" = "hex") =>
  crypto.createHmac("sha256", Buffer.from(secret, "utf8")).update(body, "utf8").digest(enc)

describe("verifyFaireWebhook", () => {
  it("accepts a valid hex signature", () => {
    const body = '{"event_type":"ORDER_PLACED"}'
    const res = verifyFaireWebhook({
      secret,
      headers: { signature: sign(body, "hex") },
      rawBody: body,
    })
    expect(res.valid).toBe(true)
  })

  it("accepts a valid base64 signature", () => {
    const body = '{"event_type":"ORDER_PLACED"}'
    const res = verifyFaireWebhook({
      secret,
      headers: { signature: sign(body, "base64") },
      rawBody: body,
    })
    expect(res.valid).toBe(true)
  })

  it("accepts svix-style v1,<sig> entries", () => {
    const body = '{"event_type":"ORDER_PLACED"}'
    const res = verifyFaireWebhook({
      secret,
      headers: { signature: `v1,${sign(body, "hex")}` },
      rawBody: body,
    })
    expect(res.valid).toBe(true)
  })

  it("rejects a tampered body", () => {
    const body = '{"event_type":"ORDER_PLACED"}'
    const res = verifyFaireWebhook({
      secret,
      headers: { signature: sign(body, "hex") },
      rawBody: body + "tampered",
    })
    expect(res.valid).toBe(false)
    expect(res.reason).toBe("signature mismatch")
  })

  it("rejects when signature header is missing", () => {
    const res = verifyFaireWebhook({
      secret,
      headers: {},
      rawBody: "{}",
    })
    expect(res.valid).toBe(false)
    expect(res.reason).toMatch(/missing/)
  })

  it("rejects when secret is empty", () => {
    const res = verifyFaireWebhook({
      secret: "",
      headers: { signature: "abc" },
      rawBody: "{}",
    })
    expect(res.valid).toBe(false)
    expect(res.reason).toMatch(/secret/)
  })

  it("enforces timestamp tolerance when a timestamp is present", () => {
    const body = "{}"
    const res = verifyFaireWebhook({
      secret,
      headers: { signature: sign(body, "hex"), timestamp: String(Math.floor(Date.now() / 1000) - 600) },
      rawBody: body,
    })
    expect(res.valid).toBe(false)
    expect(res.reason).toMatch(/timestamp/)
  })
})
