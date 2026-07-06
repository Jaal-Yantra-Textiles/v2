import crypto from "crypto"

/**
 * Verify an inbound Etsy webhook. Etsy delivers via Svix, so the scheme is the
 * standard Svix one:
 *   signedContent = `${webhook-id}.${webhook-timestamp}.${rawBody}`
 *   expected      = base64( HMAC_SHA256(secretBytes, signedContent) )
 *   header `webhook-signature` = space-separated `v1,<base64sig>` entries;
 *                                any entry matching `expected` passes.
 *
 * The secret is typically `whsec_<base64>`; we strip the prefix and base64-decode
 * to the raw key bytes (falling back to utf8 if it isn't valid base64).
 */

export type EtsyWebhookHeaders = {
  id?: string
  timestamp?: string
  signature?: string
}

// Reject deliveries whose timestamp is more than this far from now (replay guard).
const TOLERANCE_SECONDS = 5 * 60

const decodeSecret = (secret: string): Buffer => {
  const raw = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret
  const decoded = Buffer.from(raw, "base64")
  // If base64 decoding produced nothing usable, treat the secret as raw utf8.
  return decoded.length ? decoded : Buffer.from(raw, "utf8")
}

const safeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

export function verifyEtsyWebhook(opts: {
  secret: string
  headers: EtsyWebhookHeaders
  rawBody: string
  toleranceSeconds?: number
  now?: number
}): { valid: boolean; reason?: string } {
  const { secret, headers, rawBody } = opts
  const { id, timestamp, signature } = headers

  if (!secret) return { valid: false, reason: "no signing secret configured" }
  if (!id || !timestamp || !signature) {
    return { valid: false, reason: "missing webhook signature headers" }
  }

  // Replay guard.
  const ts = Number(timestamp)
  const now = Math.floor((opts.now ?? Date.now()) / 1000)
  const tolerance = opts.toleranceSeconds ?? TOLERANCE_SECONDS
  if (!Number.isFinite(ts) || Math.abs(now - ts) > tolerance) {
    return { valid: false, reason: "timestamp outside tolerance" }
  }

  const signedContent = `${id}.${timestamp}.${rawBody}`
  const expected = crypto
    .createHmac("sha256", decodeSecret(secret))
    .update(signedContent)
    .digest("base64")

  // Header may carry several space-separated `v1,<sig>` entries.
  const passed = signature
    .split(" ")
    .map((part) => (part.includes(",") ? part.split(",")[1] : part))
    .some((sig) => safeEqual(sig, expected))

  return passed ? { valid: true } : { valid: false, reason: "signature mismatch" }
}
