/**
 * In-house analytics ingestion buffer (#559 slice 1/2).
 *
 * Producer/consumer queue on Redis — NOT a long-running workflow:
 *   - `/web/analytics/track` (producer) LPUSHes the event and returns immediately.
 *   - `drain-analytics-buffer` job (consumer) RPOPs a batch every minute and runs
 *     the existing `trackAnalyticsEventWorkflow` per event (short-lived).
 *
 * Heartbeats are deliberately NOT buffered — they drive the real-time live-visitor
 * count, so they keep the synchronous write-through path (`isHeartbeatEvent`).
 *
 * Unlike the (now-removed) Cloudflare edge worker, the producer runs INSIDE the
 * Medusa request, so we capture the visitor's real `user_agent` + `ip_address` and
 * carry them through the buffer — no device/geo fidelity is lost.
 *
 * Pure helpers (env flag, heartbeat test, order/dedupe, parse) are framework-free
 * and unit-tested; the I/O wrappers at the bottom are thin shims over ioredis.
 */
import Redis from "ioredis"

export const ANALYTICS_BUFFER_KEY = "analytics:ingest:buffer"

/** Full payload buffered per hit — carries the real UA + IP captured in /track. */
export type BufferedAnalyticsEvent = {
  event_id: string
  website_id: string
  event_type: "pageview" | "custom_event"
  event_name?: string
  pathname: string
  referrer?: string
  visitor_id: string
  session_id: string
  query_string?: string
  is_404?: boolean
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  utm_content?: string
  metadata?: Record<string, any>
  user_agent: string
  ip_address: string
  /** ISO string — serialized back to a Date in the drain. */
  timestamp: string
}

/** Batch ingestion is opt-in via env so rollout/rollback is a single flag flip. */
export function isBatchIngestEnabled(): boolean {
  const v = (process.env.ANALYTICS_BATCH_INGEST || "").toLowerCase()
  return v === "1" || v === "true" || v === "yes" || v === "on"
}

/**
 * Heartbeats drive the real-time live-visitor count, so they must bypass the
 * buffer and always take the synchronous write-through path.
 */
export function isHeartbeatEvent(
  event_type: string | undefined,
  event_name: string | undefined
): boolean {
  return event_type === "custom_event" && event_name === "heartbeat"
}

/**
 * Sort ascending by timestamp and drop within-batch `event_id` duplicates
 * (first wins). Keeps session entry/exit/bounce computation correct when a
 * batch is drained out of arrival order. Pure — unit tested.
 */
export function orderAndDedupeBuffer(
  events: BufferedAnalyticsEvent[]
): BufferedAnalyticsEvent[] {
  const seen = new Set<string>()
  const deduped: BufferedAnalyticsEvent[] = []
  for (const e of events || []) {
    if (e?.event_id) {
      if (seen.has(e.event_id)) continue
      seen.add(e.event_id)
    }
    deduped.push(e)
  }
  deduped.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  )
  return deduped
}

/** Safe parse — drop malformed/incomplete buffer entries instead of throwing. */
export function parseBufferedEvent(raw: string): BufferedAnalyticsEvent | null {
  try {
    const o = JSON.parse(raw)
    if (
      o &&
      typeof o.website_id === "string" &&
      typeof o.pathname === "string" &&
      typeof o.visitor_id === "string" &&
      typeof o.session_id === "string"
    ) {
      return o as BufferedAnalyticsEvent
    }
    return null
  } catch {
    return null
  }
}

// --------------------------- I/O (ioredis shims) ---------------------------

let _redis: Redis | null = null

/** Singleton ioredis client for the ingest buffer (separate from module conns). */
export function getIngestRedis(): Redis {
  if (!_redis) {
    const url = process.env.REDIS_URL
    if (!url) {
      throw new Error("REDIS_URL not set — analytics ingest buffer unavailable")
    }
    _redis = new Redis(url, { maxRetriesPerRequest: null })
  }
  return _redis
}

/** Producer: LPUSH onto the head of the buffer list. */
export async function pushBufferedEvent(
  redis: Redis,
  event: BufferedAnalyticsEvent
): Promise<void> {
  await redis.lpush(ANALYTICS_BUFFER_KEY, JSON.stringify(event))
}

/**
 * Consumer: RPOP up to `max` entries from the tail (FIFO with the LPUSH
 * producer). Returns parsed events, malformed entries dropped.
 *
 * Note: at-most-once on a hard crash between RPOP and persist (RPOP removes the
 * entries). Acceptable for analytics; upgrade to an LMOVE processing-queue if
 * stricter delivery is ever needed.
 */
export async function drainBuffer(
  redis: Redis,
  max: number
): Promise<BufferedAnalyticsEvent[]> {
  if (max <= 0) return []
  // count arg requires Redis >= 6.2; cast through any for the ioredis overload.
  const raw = (await (redis as any).rpop(ANALYTICS_BUFFER_KEY, max)) as
    | string[]
    | null
  if (!raw || !raw.length) return []
  return raw
    .map(parseBufferedEvent)
    .filter((e): e is BufferedAnalyticsEvent => !!e)
}
