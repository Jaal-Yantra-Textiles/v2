import crypto from "crypto"

/**
 * Verify an inbound Faire webhook.
 *
 * Faire signs each delivery with an HMAC-SHA256 of the raw request body using
 * the webhook signing secret shared at registration time. The signature is sent
 * in the `X-Faire-Webhook-Signature` header, typically as a hex digest. Some
 * deployments send a base64 digest, so we accept both. The header may also
 * carry several space-separated `v1,<sig>` entries (Svix-style); any match
 * passes.
 *
 * NOTE: Faire's developer portal is access-gated; if your app uses a different
 * header name or digest encoding, adjust the headers passed in or the
 * `encoding` option accordingly.
 */

export type FaireWebhookHeaders = {
  signature?: string
  timestamp?: string
}

const TOLERANCE_SECONDS = 5 * 60

const isHex = (s: string): boolean => /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0

const safeEqual = (a: Buffer, b: Buffer): boolean => {
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export function verifyFaireWebhook(opts: {
  secret: string
  headers: FaireWebhookHeaders
  rawBody: string
  encoding?: "hex" | "base64"
  toleranceSeconds?: number
  now?: number
}): { valid: boolean; reason?: string } {
  const { secret, headers, rawBody } = opts
  const { signature, timestamp } = headers

  if (!secret) return { valid: false, reason: "no signing secret configured" }
  if (!signature) {
    return { valid: false, reason: "missing webhook signature header" }
  }

  // Optional replay guard — only enforced when a timestamp is present.
  if (timestamp) {
    const ts = Number(timestamp)
    const now = Math.floor((opts.now ?? Date.now()) / 1000)
    const tolerance = opts.toleranceSeconds ?? TOLERANCE_SECONDS
    if (Number.isFinite(ts) && Math.abs(now - ts) > tolerance) {
      return { valid: false, reason: "timestamp outside tolerance" }
    }
  }

  const key = Buffer.from(secret, "utf8")
  const computed = crypto
    .createHmac("sha256", key)
    .update(rawBody, "utf8")
    .digest()

  const candidates = signature
    .split(" ")
    .map((part) => (part.includes(",") ? part.split(",")[1] : part))
    .filter(Boolean)

  let passed = false
  for (const sig of candidates) {
    const encoding = opts.encoding || (isHex(sig) ? "hex" : "base64")
    let provided: Buffer
    try {
      provided = Buffer.from(sig, encoding)
    } catch {
      continue
    }
    if (provided.length && safeEqual(provided, computed)) {
      passed = true
      break
    }
  }

  return passed ? { valid: true } : { valid: false, reason: "signature mismatch" }
}
