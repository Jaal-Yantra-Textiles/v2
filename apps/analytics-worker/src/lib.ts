/**
 * #344 slice 2 — pure helpers for the Cloudflare analytics edge worker.
 *
 * Kept free of Worker globals (KV, env, request) so they unit-test in plain
 * Node. The worker (`index.ts`) wires these to the runtime.
 */

export type IngestEvent = {
  event_id: string
  website_id: string
  pathname: string
  referrer: string | null
  visitor_id: string
  session_id: string
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_term: string | null
  utm_content: string | null
  country: string | null
  timestamp: string
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null

/**
 * Map a raw client `track` payload to the exact shape the Medusa
 * `/web/analytics/ingest-batch` endpoint accepts, enriching with an
 * edge-generated `event_id` (for cross-batch dedupe / retry-safety), the
 * Cloudflare-provided `country` (free GeoIP — saves Medusa a lookup), and a
 * receive `timestamp`. Returns null when a required field is missing so the
 * caller can drop it without buffering junk.
 */
export function normalizeTrackEvent(
  raw: Record<string, unknown>,
  ctx: { country: string | null; now: string; id: string }
): IngestEvent | null {
  const website_id = str(raw.website_id)
  const pathname = str(raw.pathname)
  const visitor_id = str(raw.visitor_id)
  const session_id = str(raw.session_id)
  // The four identity fields are mandatory; without them the row is useless
  // (mirrors the endpoint's own `invalid` drop rule).
  if (!website_id || !pathname || !visitor_id || !session_id) return null

  return {
    event_id: str(raw.event_id) ?? ctx.id,
    website_id,
    pathname,
    referrer: str(raw.referrer),
    visitor_id,
    session_id,
    utm_source: str(raw.utm_source),
    utm_medium: str(raw.utm_medium),
    utm_campaign: str(raw.utm_campaign),
    utm_term: str(raw.utm_term),
    utm_content: str(raw.utm_content),
    country: str(raw.country) ?? ctx.country,
    timestamp: str(raw.timestamp) ?? ctx.now,
  }
}

/** Split into fixed-size chunks (the ingest endpoint caps a batch at 500). */
export function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr]
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/**
 * Hex HMAC-SHA256 of `message` under `secret`, via Web Crypto (available in
 * Workers and Node >=20). MUST be computed over the EXACT body string that is
 * sent — the Medusa endpoint verifies against its raw request bytes (#548), so
 * the worker signs and sends the identical string.
 */
export async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message))
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}
