/**
 * #344 slice 2 — Cloudflare analytics edge worker (`collect`).
 *
 * Architecture (see apps/docs/notes/525_MODULE_AUDIT_AND_CF_VISITOR_OFFLOAD.md):
 *   Visitor → POST /track (this worker, at the edge)
 *     ├─ normalize + buffer the event in KV  (volume sizing chose KV, not Queues)
 *     └─ respond 200 {success:true} immediately — identical contract to the
 *        legacy direct Medusa /web/analytics/track, so the client never changes
 *        behavior on edge hiccups.
 *   Cron (every minute) → drain the KV buffer → HMAC-sign → POST a batch to
 *     Medusa  POST {MEDUSA_INGEST_URL}  (the #547 ingest-batch endpoint), then
 *     delete the drained keys only on a 2xx (so failures retry next tick).
 *
 * Downstream (rollup job → analytics_daily_stats → stats panels) is untouched.
 */
import { normalizeTrackEvent, chunk, hmacHex, type IngestEvent } from "./lib"

export interface Env {
  ANALYTICS_BUFFER: KVNamespace
  /** Full URL of the Medusa ingest endpoint, e.g. https://v3.jaalyantra.com/web/analytics/ingest-batch */
  MEDUSA_INGEST_URL: string
  /** Shared secret — MUST equal Medusa's ANALYTICS_INGEST_SECRET. Set via `wrangler secret put`. */
  ANALYTICS_INGEST_SECRET: string
  /** Comma-separated allowed origins for CORS, or "*" (default). */
  ALLOWED_ORIGINS?: string
  /** Max keys drained per cron tick (<=1000 KV list cap; default 500 = endpoint batch cap). */
  MAX_DRAIN?: string
}

const BUFFER_PREFIX = "evt:"
const BUFFER_TTL_SECONDS = 60 * 60 * 24 // safety net: KV self-expires un-drained events after 24h
const ENDPOINT_BATCH_CAP = 500

function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? "*").trim()
  const allowOrigin =
    allowed === "*"
      ? "*"
      : allowed.split(",").map((o) => o.trim()).includes(origin ?? "")
      ? (origin as string)
      : ""
  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  }
  if (allowOrigin) h["Access-Control-Allow-Origin"] = allowOrigin
  return h
}

const ok = (env: Env, origin: string | null) =>
  new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders(env, origin) },
  })

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin")
    const url = new URL(request.url)

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env, origin) })
    }
    if (request.method === "GET") {
      return new Response("analytics-worker ok", { status: 200 })
    }
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 })
    }

    // Fire-and-forget contract: ALWAYS 200 so a malformed/over-limit payload or
    // a transient KV error never changes client behavior. We just drop on error.
    try {
      const raw = (await request.json()) as Record<string, unknown>
      const event = normalizeTrackEvent(raw, {
        country: (request as any).cf?.country ?? null, // free GeoIP at the edge
        now: new Date().toISOString(),
        id: crypto.randomUUID(),
      })
      if (event) {
        const key = `${BUFFER_PREFIX}${Date.now()}:${event.event_id}`
        await env.ANALYTICS_BUFFER.put(key, JSON.stringify(event), {
          expirationTtl: BUFFER_TTL_SECONDS,
        })
      }
    } catch {
      // swallow — never break the page
    }
    return ok(env, origin)
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(drain(env))
  },
}

/** Drain the KV buffer → HMAC-signed batched POST → delete drained keys on success. */
export async function drain(env: Env): Promise<void> {
  if (!env.ANALYTICS_INGEST_SECRET || !env.MEDUSA_INGEST_URL) return
  const cap = Math.min(
    Number(env.MAX_DRAIN) > 0 ? Number(env.MAX_DRAIN) : ENDPOINT_BATCH_CAP,
    1000
  )

  const listed = await env.ANALYTICS_BUFFER.list({ prefix: BUFFER_PREFIX, limit: cap })
  if (!listed.keys.length) return

  // Pull each buffered event (KV list returns names only).
  const pairs = await Promise.all(
    listed.keys.map(async (k) => {
      const v = await env.ANALYTICS_BUFFER.get(k.name)
      return v ? { key: k.name, event: JSON.parse(v) as IngestEvent } : null
    })
  )
  const live = pairs.filter((p): p is { key: string; event: IngestEvent } => !!p)
  if (!live.length) return

  // Respect the endpoint's per-request cap; each batch deletes only on 2xx.
  for (const group of chunk(live, ENDPOINT_BATCH_CAP)) {
    const body = JSON.stringify({ events: group.map((g) => g.event) })
    const signature = await hmacHex(env.ANALYTICS_INGEST_SECRET, body)
    let resOk = false
    try {
      const res = await fetch(env.MEDUSA_INGEST_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-analytics-signature": `sha256=${signature}`,
        },
        body, // exact bytes we signed (endpoint verifies against raw body, #548)
      })
      resOk = res.ok
    } catch {
      resOk = false
    }
    // Only remove from the buffer once Medusa has durably accepted the batch;
    // a failed POST leaves the keys so the next cron tick retries (idempotent
    // server-side via event_id, so retries can't double-count).
    if (resOk) {
      await Promise.all(group.map((g) => env.ANALYTICS_BUFFER.delete(g.key)))
    }
  }
}
