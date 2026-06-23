/**
 * cache.ts — thin stale-while-revalidate Redis shim for the marketing headline
 * blob (#659 slice 3, PR-3b).
 *
 * Mirrors the `getIngestRedis()` singleton shape in
 * `analytics/ingest-buffer.ts:117` — do NOT introduce a second Redis client
 * pattern or a new dependency; this reuses the same `ioredis` + `REDIS_URL`
 * discipline, keyed under the `marketing:headline` namespace.
 *
 * Cache discipline (spec §4.2): the durable cache is the
 * `marketing_metric_snapshot` Postgres table; Redis is the hot path only. Every
 * function here is FAIL-SOFT — a missing `REDIS_URL` or a down Redis never
 * throws; reads return `null` (caller falls back to Postgres) and writes are
 * best-effort. So the daily-refresh job's snapshot rows always survive even when
 * the cache warm fails (job algorithm step 6: "never throw past persist").
 */
import Redis from "ioredis"

/** Namespace key for the cached headline+strip+trend blob. */
export const MARKETING_HEADLINE_KEY = "marketing:headline"

/**
 * Soft TTL (seconds) for the headline blob. 26h is intentionally longer than
 * the daily refresh interval so a skipped cron still serves yesterday's number
 * (the reader flags it `stale: true`) rather than a cold miss.
 */
export const MARKETING_HEADLINE_TTL_SEC = 26 * 60 * 60

let _redis: Redis | null = null

/**
 * Singleton ioredis client for the marketing cache, or `null` when `REDIS_URL`
 * is unset. Unlike `getIngestRedis()` (which throws), this returns null so the
 * SWR path degrades to Postgres instead of crashing the job/route.
 */
export function getMarketingRedis(): Redis | null {
  if (_redis) return _redis
  const url = process.env.REDIS_URL
  if (!url) return null
  _redis = new Redis(url, { maxRetriesPerRequest: null })
  return _redis
}

/**
 * Read the cached headline blob. Returns `null` on miss, parse failure, no
 * Redis, or any I/O error — callers MUST treat null as "fall back to Postgres".
 */
export async function getHeadlineCache<T = unknown>(): Promise<T | null> {
  const redis = getMarketingRedis()
  if (!redis) return null
  try {
    const raw = await redis.get(MARKETING_HEADLINE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/**
 * Best-effort write of the headline blob with a soft TTL. Swallows all errors
 * (cache warm is non-critical — the snapshot rows are the source of truth).
 * Returns true on a confirmed write, false otherwise.
 */
export async function setHeadlineCache(
  blob: unknown,
  ttlSec: number = MARKETING_HEADLINE_TTL_SEC
): Promise<boolean> {
  const redis = getMarketingRedis()
  if (!redis) return false
  try {
    await redis.set(MARKETING_HEADLINE_KEY, JSON.stringify(blob), "EX", ttlSec)
    return true
  } catch {
    return false
  }
}
