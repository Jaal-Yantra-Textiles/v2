/**
 * @file Pure helpers for the analytics batch-ingest endpoint (#344 slice 1).
 * @description
 * These are framework-free, side-effect-free functions so they can be unit
 * tested without booting Medusa. They cover the two non-trivial concerns of
 * the edge-offload ingest path:
 *   1. Authenticating the caller (shared-secret OR HMAC-signed body).
 *   2. Normalizing + deduplicating a batch of events before persistence.
 *
 * The actual persistence (workflow runs, session upserts) lives in route.ts.
 */
import { createHmac, timingSafeEqual } from "crypto";

export type RawIngestEvent = {
  event_id?: string | null;
  website_id?: string | null;
  event_type?: string | null;
  event_name?: string | null;
  pathname?: string | null;
  referrer?: string | null;
  visitor_id?: string | null;
  session_id?: string | null;
  query_string?: string | null;
  is_404?: boolean | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
  country?: string | null;
  metadata?: Record<string, any> | null;
  // Accept either `timestamp` or `ts` (epoch ms / ISO string) from the edge worker.
  timestamp?: string | number | Date | null;
  ts?: string | number | Date | null;
};

export type NormalizedIngestEvent = {
  event_id: string | null;
  website_id: string;
  event_type: "pageview" | "custom_event";
  event_name: string | null;
  pathname: string;
  referrer: string | null;
  visitor_id: string;
  session_id: string;
  query_string: string | null;
  is_404: boolean;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  country: string | null;
  metadata: Record<string, any> | null;
  timestamp: Date;
};

/**
 * Constant-time string comparison that never throws on length mismatch
 * (timingSafeEqual requires equal-length buffers).
 */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) {
    // Still run a comparison to avoid leaking length via early-return timing.
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

/**
 * Verify an inbound ingest request. Supports two interchangeable schemes so the
 * CF Worker (slice 2) can pick whichever is easier in its runtime:
 *   - Shared secret: header value equals `secret` (timing-safe).
 *   - HMAC: `signatureHeader` is `sha256=<hex>` of `rawBody` keyed by `secret`.
 *
 * Returns false (never throws) when the secret is unset or nothing matches, so
 * the route can reject cleanly with 401.
 */
export function verifyIngestAuth(opts: {
  secret?: string | null;
  sharedSecretHeader?: string | null;
  signatureHeader?: string | null;
  rawBody?: string | null;
}): boolean {
  const { secret, sharedSecretHeader, signatureHeader, rawBody } = opts;
  if (!secret) return false;

  // 1. Shared-secret scheme.
  if (sharedSecretHeader && safeEqual(sharedSecretHeader, secret)) {
    return true;
  }

  // 2. HMAC scheme.
  if (signatureHeader && rawBody != null) {
    const provided = signatureHeader.startsWith("sha256=")
      ? signatureHeader.slice("sha256=".length)
      : signatureHeader;
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    if (provided.length === expected.length && safeEqual(provided, expected)) {
      return true;
    }
  }

  return false;
}

function toDate(value: RawIngestEvent["timestamp"]): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

const nullableText = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

/**
 * Normalize a raw batch and drop duplicates.
 *
 * - Invalid events (missing website_id / pathname / visitor_id / session_id)
 *   are dropped and counted as `invalid`.
 * - Events carrying an `event_id` are deduplicated WITHIN the batch (first wins)
 *   — protects against worker retries that re-send overlapping windows.
 * - Events without an `event_id` are always kept (cannot be safely deduped).
 * - Output is sorted ascending by timestamp so session entry/exit/bounce
 *   computation stays correct under batching.
 * - `fallbackTimestamp` is used when an event omits both `timestamp` and `ts`.
 */
export function normalizeAndDedupeBatch(
  events: RawIngestEvent[],
  fallbackTimestamp: Date
): {
  normalized: NormalizedIngestEvent[];
  invalid: number;
  deduped: number;
} {
  const seen = new Set<string>();
  const out: NormalizedIngestEvent[] = [];
  let invalid = 0;
  let deduped = 0;

  for (const e of events || []) {
    const website_id = nullableText(e?.website_id);
    const pathname = nullableText(e?.pathname);
    const visitor_id = nullableText(e?.visitor_id);
    const session_id = nullableText(e?.session_id);

    if (!website_id || !pathname || !visitor_id || !session_id) {
      invalid++;
      continue;
    }

    const event_id = nullableText(e?.event_id);
    if (event_id) {
      if (seen.has(event_id)) {
        deduped++;
        continue;
      }
      seen.add(event_id);
    }

    const event_type =
      e?.event_type === "custom_event" ? "custom_event" : "pageview";

    out.push({
      event_id,
      website_id,
      event_type,
      event_name: nullableText(e?.event_name),
      pathname,
      referrer: nullableText(e?.referrer),
      visitor_id,
      session_id,
      query_string: nullableText(e?.query_string),
      is_404: e?.is_404 === true,
      utm_source: nullableText(e?.utm_source),
      utm_medium: nullableText(e?.utm_medium),
      utm_campaign: nullableText(e?.utm_campaign),
      utm_term: nullableText(e?.utm_term),
      utm_content: nullableText(e?.utm_content),
      country: nullableText(e?.country),
      metadata:
        e?.metadata && typeof e.metadata === "object" ? e.metadata : null,
      timestamp: toDate(e?.timestamp) ?? toDate(e?.ts) ?? fallbackTimestamp,
    });
  }

  out.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return { normalized: out, invalid, deduped };
}

/**
 * Given the candidate event_ids in a batch and the set already persisted,
 * return the subset of `normalized` events that are new (should be inserted).
 * Events without an event_id are always kept (can't dedupe cross-batch).
 */
export function filterAlreadyPersisted(
  normalized: NormalizedIngestEvent[],
  existingEventIds: Iterable<string>
): { fresh: NormalizedIngestEvent[]; skipped: number } {
  const existing = new Set(existingEventIds);
  const fresh: NormalizedIngestEvent[] = [];
  let skipped = 0;
  for (const e of normalized) {
    if (e.event_id && existing.has(e.event_id)) {
      skipped++;
      continue;
    }
    fresh.push(e);
  }
  return { fresh, skipped };
}
